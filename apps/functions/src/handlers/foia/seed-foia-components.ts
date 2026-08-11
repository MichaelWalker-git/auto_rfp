import * as https from 'https';
import middy from '@middy/core';

import type { FoiaComponentCreateRequest } from '@auto-rfp/core';
import { normalizeAgencyTitle } from '@auto-rfp/core';

import { withSentryLambda } from '@/sentry-lambda';
import { nowIso } from '@/helpers/date';
import { upsertFoiaComponent } from '@/helpers/foia-component';

/**
 * Seeds the FOIA.gov agency-component directory into DynamoDB.
 *
 * Runs monthly. FOIA.gov is the authoritative published source for where a
 * records request should be sent, and mirroring it means the nightly reconciler
 * never makes a network call to pick a legal recipient — the same opportunity
 * resolves the same way on every run, which a live API cannot guarantee.
 *
 * The API answers unauthenticated, but `DEMO_KEY` rate-limits (HTTP 429) after a
 * couple of pages. An api.data.gov key is read from SSM when present; a missing
 * key degrades to unauthenticated with backoff rather than failing outright.
 */

const FOIA_API_HOST = 'api.foia.gov';
const FOIA_API_PATH = '/api/agency_components';
const PAGE_SIZE = 50;
/** Backstop against an upstream pagination change looping forever. */
const MAX_PAGES = 40;
/** Politeness delay between pages; the API is a free public service. */
const PAGE_DELAY_MS = 300;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const httpsGetJson = async (url: URL, agent?: https.Agent): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const req = https.get(url, { agent }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        if (res.statusCode && res.statusCode >= 400) {
          reject(new Error(`FOIA.gov API ${res.statusCode}: ${body.substring(0, 300)}`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('Invalid JSON from FOIA.gov'));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });

/** The subset of the JSON:API payload we consume. */
interface RawComponent {
  id?: string;
  attributes?: {
    title?: string;
    abbreviation?: string;
    status?: boolean;
    email?: string[];
    telephone?: string;
    is_centralized?: boolean;
    portal_submission_format?: string;
    submission_fax?: string;
    submission_web?: { uri?: string };
    submission_address?: {
      address_line1?: string;
      address_line2?: string;
      address_line3?: string;
      locality?: string;
      administrative_area?: string;
      postal_code?: string;
      country_code?: string;
    };
  };
  relationships?: { agency?: { data?: { id?: string } } };
}

/** Maps one API record to our create DTO. */
const toCreateRequest = (raw: RawComponent, fetchedAt: string): FoiaComponentCreateRequest | null => {
  const id = raw.id;
  const a = raw.attributes;
  if (!id || !a?.title) return null;

  const addr = a.submission_address;

  return {
    componentId: id,
    title: a.title,
    abbreviation: a.abbreviation ?? '',
    agencyId: raw.relationships?.agency?.data?.id ?? null,
    // FOIA.gov marks ~a third of components inactive; their mailboxes may be
    // decommissioned, so this flag gates auto-send downstream.
    isActive: a.status !== false,
    emails: (a.email ?? []).filter((e) => typeof e === 'string' && e.trim().length > 0),
    submissionAddress: addr
      ? {
          addressLine1: addr.address_line1 ?? null,
          addressLine2: addr.address_line2 ?? null,
          addressLine3: addr.address_line3 ?? null,
          locality: addr.locality ?? null,
          administrativeArea: addr.administrative_area ?? null,
          postalCode: addr.postal_code ?? null,
          countryCode: addr.country_code ?? null,
        }
      : null,
    submissionWebUrl: a.submission_web?.uri ?? null,
    submissionFax: a.submission_fax ?? null,
    telephone: a.telephone ?? null,
    portalSubmissionFormat: a.portal_submission_format ?? null,
    isCentralized: a.is_centralized ?? null,
    fetchedAt,
  };
};

/** Pages the whole directory. */
const fetchAllComponents = async (apiKey: string | undefined): Promise<RawComponent[]> => {
  const all: RawComponent[] = [];

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(FOIA_API_PATH, `https://${FOIA_API_HOST}`);
    // The API accepts DEMO_KEY, and answers without a key at all — but both are
    // rate-limited, hence the delay below.
    url.searchParams.set('api_key', apiKey ?? 'DEMO_KEY');
    url.searchParams.set('page[offset]', String(page * PAGE_SIZE));

    const json = (await httpsGetJson(url)) as { data?: RawComponent[] };
    const batch = json.data ?? [];
    if (batch.length === 0) break;

    all.push(...batch);
    await sleep(PAGE_DELAY_MS);
  }

  return all;
};

interface SeedEvent {
  detail?: {
    /** Fetch and report without writing. */
    dryRun?: boolean;
  };
}

export const baseHandler = async (event: SeedEvent) => {
  const dryRun = Boolean(event?.detail?.dryRun);
  const fetchedAt = nowIso();

  // Optional — the seeder works without it, just more slowly.
  const apiKey = process.env['FOIA_GOV_API_KEY']?.trim() || undefined;
  if (!apiKey) {
    console.warn('[foia-seed] no FOIA_GOV_API_KEY set — using the shared demo quota');
  }

  const raw = await fetchAllComponents(apiKey);
  console.log(`[foia-seed] fetched ${raw.length} components${dryRun ? ' (dry run)' : ''}`);

  const records = raw
    .map((r) => toCreateRequest(r, fetchedAt))
    .filter((r): r is FoiaComponentCreateRequest => r !== null);

  const withEmail = records.filter((r) => r.isActive && r.emails.length > 0).length;
  const active = records.filter((r) => r.isActive).length;

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      fetched: raw.length,
      usable: records.length,
      active,
      emailable: withEmail,
    };
  }

  // Pointer-row counts accumulate across the pass so ambiguity is preserved:
  // "Office of Inspector General" has 12 identically-titled components and must
  // never resolve. Counted here from the full record set — computing it up front
  // rather than as a side effect of writing means a failed write cannot make an
  // ambiguous key look unique, which would turn a refusal into a wrong-agency
  // match on the next resolution.
  const claimed = { titles: new Map<string, number>(), abbrs: new Map<string, number>() };
  for (const record of records) {
    const t = normalizeAgencyTitle(record.title);
    if (t) claimed.titles.set(t, (claimed.titles.get(t) ?? 0) + 1);
    const a = (record.abbreviation ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (a) claimed.abbrs.set(a, (claimed.abbrs.get(a) ?? 0) + 1);
  }

  const ambiguousTitles = [...claimed.titles.values()].filter((n) => n > 1).length;
  const ambiguousAbbrs = [...claimed.abbrs.values()].filter((n) => n > 1).length;

  let written = 0;
  let failed = 0;

  for (const record of records) {
    // One bad record must not abandon the rest of the directory.
    try {
      await upsertFoiaComponent(record, claimed);
      written += 1;
    } catch (err) {
      failed += 1;
      console.error(
        `[foia-seed] failed to write ${record.componentId} (${record.title}):`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  console.log(
    `[foia-seed] wrote ${written}, failed ${failed}, active ${active}, emailable ${withEmail}, ` +
      `ambiguous titles ${ambiguousTitles}, ambiguous abbreviations ${ambiguousAbbrs}`,
  );

  return {
    ok: true,
    dryRun: false,
    fetched: raw.length,
    written,
    failed,
    active,
    emailable: withEmail,
    ambiguousTitles,
    ambiguousAbbrs,
  };
};

export const handler = withSentryLambda(middy(baseHandler));
