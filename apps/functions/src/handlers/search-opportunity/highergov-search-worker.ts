/**
 * highergov-search-worker — async worker.
 *
 * Invoked fire-and-forget (InvocationType: 'Event') by the unified search
 * handler when a HigherGov saved-search (search_id) has no fresh cache row.
 * NOT fronted by API Gateway — no middy, no apiResponse — so it can take the
 * ~30s+ HigherGov `/opportunity/` needs without hitting the 30s Gateway ceiling.
 *
 * Flow:
 *   1. mark the cache row PENDING was already done by the handler
 *   2. fetch the saved search from HigherGov
 *   3. write results (READY) or the failure (ERROR) to the cache row
 * The frontend polls the search endpoint until the row leaves PENDING.
 */
import https from 'https';

import { withSentryLambda } from '@/sentry-lambda';
import { getApiKey } from '@/helpers/api-key-storage';
import { HIGHERGOV_SECRET_PREFIX, HIGHERGOV_BASE_URL } from '@/constants/highergov';
import { searchHigherGovOpportunities, type HigherGovConfig } from '@/helpers/highergov';
import {
  getHigherGovSearchCache,
  markHigherGovSearchReady,
  markHigherGovSearchError,
} from '@/helpers/highergov-search-cache';
import { higherGovToSearchOpportunity, HigherGovSearchJobSchema, type HigherGovSearchJob } from '@auto-rfp/core';

const httpsAgent = new https.Agent({ keepAlive: true });

export type HigherGovSearchWorkerResult = {
  status: 'READY' | 'ERROR' | 'SKIPPED';
  count?: number;
  reason?: string;
};

export const runHigherGovSearchJob = async (
  input: HigherGovSearchJob,
): Promise<HigherGovSearchWorkerResult> => {
  const { success, data } = HigherGovSearchJobSchema.safeParse(input);
  if (!success) return { status: 'SKIPPED', reason: 'invalid-job' };

  const { orgId, searchId, pageSize } = data;

  // Preserve the startedAt the handler stamped when it marked PENDING, so the
  // cache reflects the true fetch start (drives stale-PENDING detection).
  const existing = await getHigherGovSearchCache(orgId, searchId);
  const startedAt = existing?.startedAt ?? new Date().toISOString();

  const apiKey = await getApiKey(orgId, HIGHERGOV_SECRET_PREFIX);
  if (!apiKey) {
    const nowIso = new Date().toISOString();
    await markHigherGovSearchError(orgId, searchId, 'No HigherGov API key configured', startedAt, nowIso, Date.now());
    return { status: 'ERROR', reason: 'no-highergov-key' };
  }

  const cfg: HigherGovConfig = { baseUrl: HIGHERGOV_BASE_URL, apiKey, httpsAgent };

  try {
    const resp = await searchHigherGovOpportunities(cfg, {
      searchId,
      ordering: '-captured_date',
      pageSize,
      pageNumber: 1,
    });
    const opportunities = resp.results.map(higherGovToSearchOpportunity);
    const nowIso = new Date().toISOString();
    await markHigherGovSearchReady(orgId, searchId, opportunities, resp.totalCount, startedAt, nowIso, Date.now());
    return { status: 'READY', count: opportunities.length };
  } catch (e) {
    const message = e instanceof Error ? e.message : 'HigherGov search failed';
    const nowIso = new Date().toISOString();
    await markHigherGovSearchError(orgId, searchId, message, startedAt, nowIso, Date.now());
    return { status: 'ERROR', reason: message };
  }
};

export const handler = withSentryLambda(
  async (event: HigherGovSearchJob): Promise<HigherGovSearchWorkerResult> => runHigherGovSearchJob(event),
);
