/**
 * search-opportunity.ts
 *
 * Unified helper for all opportunity search integrations.
 * Combines SAM.gov and DIBBS API clients, attachment utilities,
 * and saved-search DynamoDB helpers.
 *
 * Adding a new source: add a new section below following the same pattern.
 */

// ─── Re-export everything from samgov.ts and dibbs.ts ────────────────────────
// This file is the single import point for all search-opportunity helpers.

export * from './samgov';
export * from './dibbs';
export * from './highergov';

// ─── Timeout utility for external API calls ─────────────────────────────────

export const SOURCE_TIMEOUT_MS = 15_000;

export const withSourceTimeout = <T>(promise: Promise<T>, label: string, ms = SOURCE_TIMEOUT_MS): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} is responding slowly. Please try again later.`)), ms),
    ),
  ]);

// ─── HigherGov search_id page size ──────────────────────────────────────────

/**
 * HigherGov returns HTTP 500 for `search_id` requests once `page_size` reaches 20
 * — measured against the live API: 5 and 10 succeed, 20/25/100 all fail. The
 * default page size of 25 therefore made every saved-search query fail, so
 * requests on that path are capped here.
 */
export const HIGHERGOV_SEARCH_ID_MAX_PAGE_SIZE = 10;

/** Page size to request from HigherGov, capped when querying by `search_id`. */
export const higherGovPageSize = (requested: number, hasSearchId: boolean): number =>
  hasSearchId ? Math.min(requested, HIGHERGOV_SEARCH_ID_MAX_PAGE_SIZE) : requested;
