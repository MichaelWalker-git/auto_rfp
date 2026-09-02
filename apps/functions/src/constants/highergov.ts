/** Secrets Manager prefix for HigherGov API keys */
export const HIGHERGOV_SECRET_PREFIX = 'highergov';

/** Base URL for HigherGov API */
export const HIGHERGOV_BASE_URL = 'https://www.highergov.com/api-external';

/**
 * Partition key for the async HigherGov search-results cache. A background
 * worker writes results here keyed by `${orgId}#${searchId}`; the search
 * handler reads them so a slow (~30s+) saved-search fetch never blocks the
 * synchronous request past the API Gateway ceiling.
 */
export const HIGHERGOV_SEARCH_CACHE_PK = 'HIGHERGOV_SEARCH_CACHE';

/**
 * How long a cached HigherGov search stays fresh before we refetch (seconds).
 * Also drives the DynamoDB TTL so stale rows self-delete. 10 min balances
 * "instant on repeat" against opportunities changing on HigherGov's side.
 */
export const HIGHERGOV_SEARCH_CACHE_TTL_SECONDS = 10 * 60;

/**
 * A PENDING row older than this (ms) is treated as dead (worker crashed / timed
 * out) and a fresh fetch is kicked off. Must exceed the worker's own timeout.
 */
export const HIGHERGOV_SEARCH_PENDING_STALE_MS = 150 * 1000;

/** Environment variable holding the HigherGov search worker's function name. */
export const HIGHERGOV_SEARCH_WORKER_FUNCTION_NAME_ENV = 'HIGHERGOV_SEARCH_FUNCTION_NAME';