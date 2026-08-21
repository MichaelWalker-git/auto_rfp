import * as https from 'https';

import { FOIA_COMPONENT_PK, HIGHERGOV_AGENCY_CACHE_DAYS } from '@/constants/foia';
import { getItem, putItem } from '@/helpers/db';
import { nowIso } from '@/helpers/date';
import type { HigherGovConfig } from '@/helpers/highergov';

/**
 * Resolves a HigherGov agency key to its department hierarchy.
 *
 * Solves the problem that HigherGov stores the *leaf office* as an opportunity's
 * agency — "ACC Orlando", "NPS Midwest Region", "U.S. Embassy In Tbilisi". None
 * of those are FOIA components, so matching them directly always fails; the
 * component that answers records requests is somewhere up their hierarchy.
 *
 * Verified against the live API: `/api-external/agency/?agency_key=N` returns
 * `level_1` … `level_7`, with the department at `level_1`. Two quirks found while
 * probing, both load-bearing:
 *   - the `level_*` fields are NOT present on the `agency` object embedded in
 *     opportunity search results, only on this dedicated endpoint;
 *   - the `search=` query parameter is silently ignored (every query returned
 *     the same agency), so `agency_key` is the only usable lookup.
 */

/** One rung of the hierarchy, root first. */
export interface AgencyHierarchy {
  agencyKey: string;
  /** Level 1 … 7 in order, root (department) first. Empty rungs omitted. */
  levels: string[];
  fetchedAt: string;
}

const buildAgencyCacheSk = (agencyKey: string): string => `HG_AGENCY#${agencyKey}`;

interface CachedHierarchy extends AgencyHierarchy {
  /** DynamoDB TTL attribute — the table already has TTL enabled on `ttl`. */
  ttl: number;
}

const httpsGetJson = async (url: URL, agent?: https.Agent): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const req = https.get(url, { agent }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`HigherGov agency API ${res.statusCode}: ${body.substring(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Invalid JSON from HigherGov agency API'));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });

interface RawAgencyLevel {
  agency_key?: number | string;
  agency_name?: string;
}

interface RawAgency {
  agency_key?: number | string;
  agency_name?: string;
  agency_abbreviation?: string;
  level_1?: RawAgencyLevel | null;
  level_2?: RawAgencyLevel | null;
  level_3?: RawAgencyLevel | null;
  level_4?: RawAgencyLevel | null;
  level_5?: RawAgencyLevel | null;
  level_6?: RawAgencyLevel | null;
  level_7?: RawAgencyLevel | null;
}

/** Flattens level_1…level_7 into an ordered root-first list of names. */
const extractLevels = (raw: RawAgency): string[] => {
  const levels: string[] = [];

  for (let i = 1; i <= 7; i += 1) {
    const level = raw[`level_${i}` as keyof RawAgency] as RawAgencyLevel | null | undefined;
    const name = level?.agency_name?.trim();
    if (name) levels.push(name);
  }

  return levels;
};

/**
 * Fetches an agency's hierarchy, caching it in DynamoDB.
 *
 * Cached because the reconciler walks every eligible opportunity nightly, and
 * agency hierarchies change on the order of years — an uncached lookup would mean
 * thousands of redundant calls against a rate-limited third-party API (10 req/s,
 * 10K records/month on our plan). One call per distinct agency instead.
 *
 * Returns null rather than throwing: a hierarchy we cannot fetch simply means the
 * resolver falls through to its later tiers and, ultimately, asks a human.
 */
export const resolveAgencyHierarchy = async (
  cfg: HigherGovConfig,
  agencyKey: string | number,
): Promise<AgencyHierarchy | null> => {
  const key = String(agencyKey).trim();
  if (!key) return null;

  const cached = await getItem<CachedHierarchy>(FOIA_COMPONENT_PK, buildAgencyCacheSk(key)).catch(
    () => null,
  );
  if (cached?.levels?.length) {
    return { agencyKey: key, levels: cached.levels, fetchedAt: cached.fetchedAt };
  }

  let raw: RawAgency | undefined;
  try {
    const url = new URL('/api-external/agency/', cfg.baseUrl);
    url.searchParams.set('api_key', cfg.apiKey);
    url.searchParams.set('agency_key', key);

    const json = (await httpsGetJson(url, cfg.httpsAgent)) as { results?: RawAgency[] };
    raw = json.results?.[0];
  } catch (err) {
    console.warn(
      `[highergov-agency] lookup failed for agency_key=${key}:`,
      err instanceof Error ? err.message : String(err),
    );
    return null;
  }

  if (!raw) return null;

  const levels = extractLevels(raw);
  if (levels.length === 0) return null;

  const fetchedAt = nowIso();

  // Best-effort cache write — a cache miss costs one API call, not correctness.
  try {
    await putItem<CachedHierarchy>(
      FOIA_COMPONENT_PK,
      buildAgencyCacheSk(key),
      {
        agencyKey: key,
        levels,
        fetchedAt,
        ttl: Math.floor(Date.now() / 1000) + HIGHERGOV_AGENCY_CACHE_DAYS * 24 * 60 * 60,
      },
      false,
    );
  } catch (err) {
    console.warn(
      `[highergov-agency] cache write failed for agency_key=${key}:`,
      err instanceof Error ? err.message : String(err),
    );
  }

  return { agencyKey: key, levels, fetchedAt };
};

/**
 * Orders a hierarchy for FOIA matching: most specific first.
 *
 * A sub-agency with its own FOIA office is the correct recipient when it has
 * one — "NPS Midwest Region" should reach the National Park Service, not the
 * Department of the Interior. Only when no specific level matches do we fall
 * back to the department.
 *
 * Note this is the opposite order from SAM's dot-path handling, where the leaf is
 * a local field office whose name collides with unrelated offices nationwide. Here
 * every rung is a real agency in HigherGov's own taxonomy, so specificity is safe.
 */
export const orderHierarchyForMatching = (levels: ReadonlyArray<string>): string[] =>
  [...levels].reverse();
