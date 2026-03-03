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
