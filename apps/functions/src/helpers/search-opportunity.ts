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

/**
 * HigherGov's /opportunity/ API consistently responds in 12–15s (both date and
 * search_id queries), which races the default 15s timeout and drops the source.
 * Give it a longer budget — the search Lambda has a 30s timeout and all sources
 * run in parallel, so there's headroom below the API Gateway 30s ceiling.
 */
export const HIGHERGOV_TIMEOUT_MS = 22_000;

export const withSourceTimeout = <T>(promise: Promise<T>, label: string, ms = SOURCE_TIMEOUT_MS): Promise<T> =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} is responding slowly. Please try again later.`)), ms),
    ),
  ]);
