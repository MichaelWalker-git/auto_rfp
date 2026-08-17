/** Partition key for the third-party service pricing cache (global scope, no orgId). */
export const SERVICE_PRICING_CACHE_PK = 'SERVICE_PRICING_CACHE';

/** Max services per batched searchServicePricing call (mirrors the tool schema cap). */
export const MAX_SERVICE_PRICING_BATCH = 10;

const DAY_SECONDS = 24 * 60 * 60;

/** Cache TTL for HIGH/MEDIUM confidence lookups — 30 days (ADR-9). */
export const SERVICE_PRICING_TTL_SECONDS = 30 * DAY_SECONDS;

/** Cache TTL for LOW confidence (no price found) lookups — ~24h so bad lookups self-heal (ADR-9). */
export const SERVICE_PRICING_LOW_CONFIDENCE_TTL_SECONDS = DAY_SECONDS;
