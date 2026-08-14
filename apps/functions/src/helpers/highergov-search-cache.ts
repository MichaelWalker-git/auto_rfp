/**
 * highergov-search-cache.ts
 *
 * DynamoDB access for the async HigherGov saved-search results cache.
 *
 * HigherGov's `/opportunity/` API takes ~30s+ for some saved searches, which
 * exceeds the API Gateway 30s ceiling — an inline search_id fetch can never
 * complete. A background worker performs the fetch and writes the results to a
 * cache row here; the search handler reads the row (returning instantly when
 * READY) and the frontend polls until the row leaves PENDING.
 */
import { getItem, putItem, type DBItem } from '@/helpers/db';
import {
  HIGHERGOV_SEARCH_CACHE_PK,
  HIGHERGOV_SEARCH_CACHE_TTL_SECONDS,
  HIGHERGOV_SEARCH_PENDING_STALE_MS,
} from '@/constants/highergov';
import type {
  HigherGovSearchCache,
  HigherGovSearchCacheStatus,
  SearchOpportunity,
} from '@auto-rfp/core';

type HigherGovSearchCacheDBItem = HigherGovSearchCache & DBItem & { ttl: number };

/** SK: `${orgId}#${searchId}` — one cache row per org + saved search. */
export const buildHigherGovSearchCacheSk = (orgId: string, searchId: string): string =>
  `${orgId}#${searchId}`;

/** Read the cache row for an org + saved search, or null if never fetched. */
export const getHigherGovSearchCache = async (
  orgId: string,
  searchId: string,
): Promise<HigherGovSearchCacheDBItem | null> =>
  getItem<HigherGovSearchCacheDBItem>(
    HIGHERGOV_SEARCH_CACHE_PK,
    buildHigherGovSearchCacheSk(orgId, searchId),
  );

/**
 * True when a cache row is usable inline — READY, or ERROR (surface the error
 * rather than silently refetch forever). PENDING is usable only until it goes
 * stale (worker crashed), after which the caller should refetch.
 */
export const isHigherGovSearchCacheStale = (
  cache: HigherGovSearchCacheDBItem | null,
  nowMs: number,
): boolean => {
  if (!cache) return true;
  if (cache.status !== 'PENDING') return false;
  const startedMs = cache.startedAt ? Date.parse(cache.startedAt) : 0;
  return nowMs - startedMs > HIGHERGOV_SEARCH_PENDING_STALE_MS;
};

const writeCache = async (
  orgId: string,
  searchId: string,
  fields: Omit<HigherGovSearchCache, 'orgId' | 'searchId'>,
  nowMs: number,
): Promise<HigherGovSearchCacheDBItem> =>
  putItem<HigherGovSearchCacheDBItem>(
    HIGHERGOV_SEARCH_CACHE_PK,
    buildHigherGovSearchCacheSk(orgId, searchId),
    {
      orgId,
      searchId,
      ttl: Math.floor(nowMs / 1000) + HIGHERGOV_SEARCH_CACHE_TTL_SECONDS,
      ...fields,
    },
  );

/** Mark a search as in-flight so concurrent requests don't all fire workers. */
export const markHigherGovSearchPending = async (
  orgId: string,
  searchId: string,
  nowIso: string,
  nowMs: number,
): Promise<HigherGovSearchCacheDBItem> =>
  writeCache(
    orgId,
    searchId,
    { status: 'PENDING', opportunities: [], totalCount: 0, error: null, startedAt: nowIso, completedAt: null },
    nowMs,
  );

/** Persist a completed fetch's results. */
export const markHigherGovSearchReady = async (
  orgId: string,
  searchId: string,
  opportunities: SearchOpportunity[],
  totalCount: number,
  startedAt: string | null,
  nowIso: string,
  nowMs: number,
): Promise<HigherGovSearchCacheDBItem> =>
  writeCache(
    orgId,
    searchId,
    { status: 'READY', opportunities, totalCount, error: null, startedAt, completedAt: nowIso },
    nowMs,
  );

/** Persist a fetch failure so the frontend can surface it instead of spinning. */
export const markHigherGovSearchError = async (
  orgId: string,
  searchId: string,
  error: string,
  startedAt: string | null,
  nowIso: string,
  nowMs: number,
): Promise<HigherGovSearchCacheDBItem> =>
  writeCache(
    orgId,
    searchId,
    { status: 'ERROR', opportunities: [], totalCount: 0, error, startedAt, completedAt: nowIso },
    nowMs,
  );

export type { HigherGovSearchCacheDBItem, HigherGovSearchCacheStatus };
