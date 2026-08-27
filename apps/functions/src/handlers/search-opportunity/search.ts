/**
 * Unified search handler.
 * POST /search-opportunities/search
 *
 * Body: { source?: 'SAM_GOV' | 'DIBBS' | 'ALL', orgId, keywords, postedFrom, postedTo, ... }
 * Searches the specified source (or all sources if source = 'ALL' / omitted).
 * Returns SearchOpportunity[] with a source badge on each result.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import https from 'https';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { z } from 'zod';

import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda, Sentry } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { getApiKey } from '@/helpers/api-key-storage';
import { SAM_GOV_SECRET_PREFIX } from '@/constants/samgov';
import { DIBBS_SECRET_PREFIX } from '@/constants/dibbs';
import {
  HIGHERGOV_SECRET_PREFIX,
  HIGHERGOV_BASE_URL,
  HIGHERGOV_SEARCH_WORKER_FUNCTION_NAME_ENV,
} from '@/constants/highergov';
import { requireEnv } from '@/helpers/env';
import { searchSamOpportunities, searchDibbsOpportunities, searchHigherGovOpportunities, withSourceTimeout, HIGHERGOV_TIMEOUT_MS } from '@/helpers/search-opportunity';
import {
  getHigherGovSearchCache,
  isHigherGovSearchCacheStale,
  markHigherGovSearchPending,
} from '@/helpers/highergov-search-cache';
import {
  samSlimToSearchOpportunity,
  dibbsSlimToSearchOpportunity,
  higherGovToSearchOpportunity,
  type HigherGovSearchJob,
  type SearchOpportunity,
} from '@auto-rfp/core';

const lambdaClient = new LambdaClient({});

/**
 * Fire-and-forget the HigherGov search worker. The worker performs the slow
 * (~30s+) saved-search fetch out of band and writes results to the cache row.
 */
const invokeHigherGovSearchWorker = async (job: HigherGovSearchJob): Promise<void> => {
  const fnName = process.env[HIGHERGOV_SEARCH_WORKER_FUNCTION_NAME_ENV];
  if (!fnName) throw new Error(`${HIGHERGOV_SEARCH_WORKER_FUNCTION_NAME_ENV} not configured`);
  await lambdaClient.send(new InvokeCommand({
    FunctionName: fnName,
    InvocationType: 'Event', // fire-and-forget
    Payload: Buffer.from(JSON.stringify(job)),
  }));
};

const SAM_BASE_URL  = requireEnv('SAM_OPPS_BASE_URL', 'https://api.sam.gov');
const DIBBS_BASE_URL = requireEnv('DIBBS_BASE_URL', 'https://www.dibbs.bsm.dla.mil');
const httpsAgent = new https.Agent({ keepAlive: true });

// ─── Request schema ───────────────────────────────────────────────────────────

const MmDdYyyy = z.string().regex(/^\d{2}\/\d{2}\/\d{4}$/, 'Expected MM/dd/yyyy');

const SearchRequestSchema = z.object({
  /** Which source(s) to search. Omit or use 'ALL' to search all configured sources. */
  source:       z.enum(['SAM_GOV', 'DIBBS', 'HIGHER_GOV', 'ALL']).default('ALL'),
  /** HigherGov source_type filter to avoid duplicating SAM/DIBBS results */
  higherGovSourceType: z.enum(['sam', 'dibbs', 'sbir', 'grant', 'sled']).optional(),
  /** HigherGov search_id — replay a saved search from HigherGov UI */
  higherGovSearchId: z.string().min(1).optional(),
  keywords:     z.string().min(1).optional(),
  naics:        z.array(z.string().min(2)).optional(),
  setAsideCode: z.string().optional(),
  postedFrom:   MmDdYyyy.optional(),
  postedTo:     MmDdYyyy.optional(),
  /** Response-deadline / closing date from (MM/dd/yyyy). SAM.gov: rdlfrom. DIBBS: closingFrom. */
  closingFrom:  MmDdYyyy.optional(),
  /** Response-deadline / closing date to (MM/dd/yyyy). SAM.gov: rdlto. DIBBS: closingTo. */
  closingTo:    MmDdYyyy.optional(),
  limit:  z.number().int().positive().max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

type SearchRequest = z.infer<typeof SearchRequestSchema>;

/**
 * HigherGov's /opportunity/ API has no keyword/NAICS/set-aside filter and no date
 * range — those must be expressed via a saved search (search_id) built in the
 * HigherGov UI. Firing a plain keyword search therefore can't return correct
 * results (it would fetch a single day and client-filter a 100-row slice), so we
 * short-circuit with this message instead of a 15s-timeout empty response.
 */
/** SAM.gov wants MM/dd/yyyy. */
const toMmDdYyyy = (d: Date): string =>
  `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

const DEFAULT_POSTED_WINDOW_DAYS = 30;

/** Fallback posted range for a request that omits one: the last 30 days. */
const defaultPostedFrom = (): string =>
  toMmDdYyyy(new Date(Date.now() - DEFAULT_POSTED_WINDOW_DAYS * 86_400_000));

const defaultPostedTo = (): string => toMmDdYyyy(new Date());

export const HIGHERGOV_KEYWORD_NEEDS_SEARCH_ID =
  'Keyword, NAICS, and set-aside search for HigherGov requires a saved search. ' +
  'Create the search on HigherGov, then paste its Search ID into the HigherGov ID field.';

// ─── Handler ──────────────────────────────────────────────────────────────────

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!event.body) return apiResponse(400, { message: 'Request body is required' });

  let raw: unknown;
  try { raw = JSON.parse(event.body); } catch { return apiResponse(400, { message: 'Invalid JSON body' }); }

  const { success, data, error } = SearchRequestSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Validation error', issues: error.issues });

  const includeSam   = data.source === 'ALL' || data.source === 'SAM_GOV';
  const includeDibbs = data.source === 'ALL' || data.source === 'DIBBS';
  const includeHigherGov = data.source === 'ALL' || data.source === 'HIGHER_GOV';

  const results: SearchOpportunity[] = [];
  const errors: Record<string, string> = {};
  let totalSamGov = 0;
  let totalDibbs  = 0;
  let totalHigherGov = 0;
  // True while a HigherGov saved-search fetch is running in the background — the
  // frontend polls (re-issues the search) until this clears. HigherGov can take
  // ~30s+ per saved search, which exceeds the API Gateway ceiling, so search_id
  // results are fetched by a worker and served from a cache row.
  let higherGovPending = false;

  // ── Run all sources in parallel to stay under 29s API Gateway limit ────
  const sourcePromises: Array<Promise<void>> = [];

  if (includeSam) {
    sourcePromises.push((async () => {
      try {
        const apiKey = await getApiKey(orgId, SAM_GOV_SECRET_PREFIX);
        if (apiKey) {
          const resp = await withSourceTimeout(
            searchSamOpportunities(
              { baseUrl: SAM_BASE_URL, apiKey, httpsAgent },
              {
                // SAM.gov requires a posted range. Default to the last 30 days
                // rather than a hardcoded calendar year — the previous
                // '01/01/2025'–'12/31/2025' literals silently excluded everything
                // posted outside 2025, which looks exactly like broken filtering.
                postedFrom:   data.postedFrom ?? defaultPostedFrom(),
                postedTo:     data.postedTo   ?? defaultPostedTo(),
                rdlfrom:      data.closingFrom,
                rdlto:        data.closingTo,
                keywords:     data.keywords,
                naics:        data.naics,
                setAsideCode: data.setAsideCode,
                limit:        data.limit ?? 25,
                offset:       data.offset ?? 0,
              },
            ),
            'SAM.gov',
          );
          totalSamGov = resp.totalRecords;
          results.push(...resp.opportunities.map(samSlimToSearchOpportunity));
        }
      } catch (e) {
        errors['SAM_GOV'] = e instanceof Error ? e.message : 'SAM.gov search failed';
      }
    })());
  }

  if (includeDibbs) {
    sourcePromises.push((async () => {
      try {
        const apiKey = await getApiKey(orgId, DIBBS_SECRET_PREFIX);
        if (apiKey) {
          const resp = await withSourceTimeout(
            searchDibbsOpportunities(
              { baseUrl: DIBBS_BASE_URL, apiKey, httpsAgent },
              {
                keywords:    data.keywords,
                naics:       data.naics,
                postedFrom:  data.postedFrom,
                postedTo:    data.postedTo,
                closingFrom: data.closingFrom,
                closingTo:   data.closingTo,
                limit:       data.limit ?? 25,
                offset:      data.offset ?? 0,
              },
            ),
            'DIBBS',
          );
          totalDibbs = resp.totalRecords;
          results.push(...resp.opportunities.map(dibbsSlimToSearchOpportunity));
        }
      } catch (e) {
        errors['DIBBS'] = e instanceof Error ? e.message : 'DIBBS search failed';
      }
    })());
  }

  if (includeHigherGov) {
    sourcePromises.push((async () => {
      try {
        const apiKey = await getApiKey(orgId, HIGHERGOV_SECRET_PREFIX);
        if (apiKey) {
          const hasSearchId = !!data.higherGovSearchId;

          // HigherGov's API can't filter by keyword/NAICS/set-aside — those only
          // work through a saved search (search_id). A plain keyword search returns
          // a single day's slice with no matches after a 15s timeout, so skip the
          // doomed call. Only surface guidance when HigherGov is the explicitly
          // chosen sole source — in ALL mode SAM/DIBBS carry the keyword search and
          // a banner on every search would be noise.
          const hasKeywordFilters = !!(data.keywords || data.naics?.length || data.setAsideCode);
          if (!hasSearchId && hasKeywordFilters) {
            if (data.source === 'HIGHER_GOV') {
              errors['HIGHER_GOV'] = HIGHERGOV_KEYWORD_NEEDS_SEARCH_ID;
            }
            return;
          }

          const pageSize = data.limit ?? 25;

          // ── Saved-search (search_id): async cache path ──────────────────────
          // HigherGov's /opportunity/ can take ~30s+ for a saved search, past
          // the API Gateway 30s ceiling, so an inline fetch can never return.
          // Serve from a cache row a background worker populates; poll until ready.
          if (hasSearchId && data.higherGovSearchId) {
            const searchId = data.higherGovSearchId;
            const nowMs = Date.now();
            const cache = await getHigherGovSearchCache(orgId, searchId);

            if (cache && cache.status === 'READY') {
              totalHigherGov = cache.totalCount;
              results.push(...cache.opportunities);
              return;
            }
            if (cache && cache.status === 'ERROR' && !isHigherGovSearchCacheStale(cache, nowMs)) {
              errors['HIGHER_GOV'] = cache.error ?? 'HigherGov search failed';
              return;
            }
            // No fresh row (or a dead PENDING) — kick off a worker and report pending.
            if (isHigherGovSearchCacheStale(cache, nowMs)) {
              await markHigherGovSearchPending(orgId, searchId, new Date().toISOString(), nowMs);
              await invokeHigherGovSearchWorker({ orgId, searchId, pageSize: Math.min(pageSize, 100) });
            }
            higherGovPending = true;
            return;
          }

          // ── Date-only / unfiltered: fast enough to run inline ───────────────
          const postedDate = data.postedFrom
            ? `${data.postedFrom.slice(6)}-${data.postedFrom.slice(0, 2)}-${data.postedFrom.slice(3, 5)}`
            : undefined;

          const resp = await withSourceTimeout(
            searchHigherGovOpportunities(
              { baseUrl: HIGHERGOV_BASE_URL, apiKey, httpsAgent },
              {
                keywords:     data.keywords,
                naics:        data.naics,
                setAsideCode: data.setAsideCode,
                sourceType:   data.higherGovSourceType,
                postedDate,
                ordering:     '-captured_date',
                pageSize,
                pageNumber: data.offset ? Math.floor(data.offset / pageSize) + 1 : 1,
              },
            ),
            'HigherGov',
            HIGHERGOV_TIMEOUT_MS,
          );
          totalHigherGov = resp.totalCount;
          results.push(...resp.results.map(higherGovToSearchOpportunity));
        }
      } catch (e) {
        errors['HIGHER_GOV'] = e instanceof Error ? e.message : 'HigherGov search failed';
      }
    })());
  }

  await Promise.all(sourcePromises);

  if (Object.keys(errors).length) {
    Sentry.addBreadcrumb({ category: 'search', message: `Partial results: ${Object.keys(errors).join(', ')} unavailable`, level: 'warning' });
  }

  // Round-robin interleave across all sources for balanced display
  const bySource: Record<string, SearchOpportunity[]> = {};
  for (const r of results) (bySource[r.source] ??= []).push(r);
  const sourceArrays = Object.values(bySource);
  const merged: SearchOpportunity[] = [];
  const maxLen = Math.max(...sourceArrays.map((a) => a.length), 0);
  for (let i = 0; i < maxLen; i++) {
    for (const arr of sourceArrays) {
      if (i < arr.length) merged.push(arr[i]!);
    }
  }

  return apiResponse(200, {
    opportunities: merged,
    totalSamGov,
    totalDibbs,
    totalHigherGov,
    total: totalSamGov + totalDibbs + totalHigherGov,
    errors: Object.keys(errors).length ? errors : undefined,
    // Signals the frontend to poll again — a HigherGov saved-search fetch is
    // still running in the background and its results will appear on a re-issue.
    higherGovPending: higherGovPending || undefined,
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read'))
    .use(httpErrorMiddleware()),
);
