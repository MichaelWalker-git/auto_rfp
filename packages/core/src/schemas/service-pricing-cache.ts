/**
 * service-pricing-cache.ts
 *
 * Cached third-party service price lookups (T2). Entries are produced by the
 * backend pricing pipeline (Brave web search → Haiku extraction) and served to
 * the `search_service_pricing` AI tool. Global scope — pricing facts are not
 * org-specific, so there is no orgId in the key or the record.
 *
 * DynamoDB: PK `SERVICE_PRICING_CACHE`, SK `{normalizedServiceName}#{billingPeriod}`.
 * Records auto-expire via the table's `ttl` attribute, tiered by confidence
 * (HIGH/MEDIUM ≈ 30 days, LOW ≈ 24h so bad lookups self-heal — ADR-9).
 */

import { z } from 'zod';
import { PK_NAME, SK_NAME } from '../constants';

// ─── Enums ──────────────────────────────────────────────────────────────────────

/**
 * Billing period of a priced service. Mirrors the `search_service_pricing`
 * tool input enum — `UNKNOWN` is both the "caller didn't say" default and a
 * valid cache-key segment.
 */
export const ServicePricingBillingPeriodSchema = z.enum([
  'MONTHLY',
  'ANNUAL',
  'ONE_TIME',
  'USAGE_BASED',
  'UNKNOWN',
]);

export type ServicePricingBillingPeriod = z.infer<typeof ServicePricingBillingPeriodSchema>;

/**
 * Extraction confidence (ADR-9):
 *   HIGH   — explicit price on an authoritative source (vendor pricing page)
 *   MEDIUM — price stated but indirect/older source (blog, reseller, review site)
 *   LOW    — no price stated in any result; cached briefly so the lookup self-heals
 */
export const ServicePricingConfidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);

export type ServicePricingConfidence = z.infer<typeof ServicePricingConfidenceSchema>;

// ─── Extracted price fact ───────────────────────────────────────────────────────

/**
 * One price fact as extracted by the model from web-search results.
 * `price` is absent when no price was stated (confidence must be LOW then).
 */
export const ServicePricingExtractionSchema = z.object({
  serviceName: z.string().min(1),
  price: z.number().nonnegative().optional(),
  currency: z.string().optional(),
  /** Pricing unit, e.g. "per user/month", "per GB", "per instance-hour". */
  unit: z.string().optional(),
  /** Plan/tier the price applies to, e.g. "Pro", "Enterprise Cloud". */
  tier: z.string().optional(),
  /** URL of the search result the price was extracted from. */
  sourceUrl: z.string().optional(),
  confidence: ServicePricingConfidenceSchema,
});

export type ServicePricingExtraction = z.infer<typeof ServicePricingExtractionSchema>;

// ─── Lookup input ───────────────────────────────────────────────────────────────

/**
 * One service in a batched pricing lookup — the per-item shape of the
 * `search_service_pricing` tool's `services` array and of
 * `searchServicePricing({services})`.
 */
export const ServicePricingLookupSchema = z.object({
  serviceName: z.string().min(1),
  billingPeriod: ServicePricingBillingPeriodSchema.optional(),
});

export type ServicePricingLookup = z.infer<typeof ServicePricingLookupSchema>;

// ─── Create request ─────────────────────────────────────────────────────────────

/**
 * Payload for writing one cache entry — the extraction plus the lookup key
 * inputs. Server-managed fields (id, normalized key, ttl, timestamps) omitted.
 * Cache entries are written only by the backend pipeline, never via a REST
 * endpoint, but the 5-type shape is kept for consistency.
 */
export const ServicePricingCacheCreateRequestSchema = ServicePricingExtractionSchema.extend({
  billingPeriod: ServicePricingBillingPeriodSchema.default('UNKNOWN'),
  /** ISO datetime the price was retrieved from the web. */
  retrievedAt: z.string().min(1),
});

export type ServicePricingCacheCreateRequest = z.infer<
  typeof ServicePricingCacheCreateRequestSchema
>;

// ─── Update request ─────────────────────────────────────────────────────────────

/**
 * Partial update — the cache key (serviceName/billingPeriod) is not patchable.
 * In practice entries are overwritten whole on refresh; this exists for the
 * common entity interface.
 */
export const ServicePricingCacheUpdateRequestSchema =
  ServicePricingCacheCreateRequestSchema.partial().omit({
    serviceName: true,
    billingPeriod: true,
  });

export type ServicePricingCacheUpdateRequest = z.infer<
  typeof ServicePricingCacheUpdateRequestSchema
>;

// ─── Item (pure domain entity) ──────────────────────────────────────────────────

export const ServicePricingCacheItemSchema = ServicePricingCacheCreateRequestSchema.extend({
  /** `{normalizedServiceName}#{billingPeriod}` — same value as the SK. */
  id: z.string().min(1),
  /** Lowercased/trimmed service name used as the first SK segment. */
  normalizedServiceName: z.string().min(1),
  /** DynamoDB TTL — epoch seconds. Confidence-tiered (30d / 24h for LOW). */
  ttl: z.number().int().positive(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export type ServicePricingCacheItem = z.infer<typeof ServicePricingCacheItemSchema>;

// ─── DB record (Item + single-table keys) ───────────────────────────────────────

export const ServicePricingCacheDBItemSchema = ServicePricingCacheItemSchema.extend({
  [PK_NAME]: z.string(), // SERVICE_PRICING_CACHE_PK
  [SK_NAME]: z.string(), // `${normalizedServiceName}#${billingPeriod}`
});

export type ServicePricingCacheDBItem = z.infer<typeof ServicePricingCacheDBItemSchema>;

// ─── Lightweight list/card shape ────────────────────────────────────────────────

export const ServicePricingCacheListItemSchema = z.object({
  id: z.string(),
  serviceName: z.string(),
  billingPeriod: ServicePricingBillingPeriodSchema,
  price: z.number().optional(),
  currency: z.string().optional(),
  unit: z.string().optional(),
  confidence: ServicePricingConfidenceSchema,
  sourceUrl: z.string().optional(),
  retrievedAt: z.string().optional(),
});

export type ServicePricingCacheListItem = z.infer<typeof ServicePricingCacheListItemSchema>;

// ─── Lookup result (returned by searchServicePricing, consumed by the tool) ─────

/**
 * Per-service result of a batched pricing lookup. `found: false` means the
 * lookup could not produce a price fact (search failed, extraction failed, or
 * lookup unavailable) — the tool renders it as "vendor quote required" (ADR-15).
 */
export const ServicePricingResultSchema = z.object({
  serviceName: z.string(),
  billingPeriod: ServicePricingBillingPeriodSchema,
  found: z.boolean(),
  price: z.number().optional(),
  currency: z.string().optional(),
  unit: z.string().optional(),
  tier: z.string().optional(),
  sourceUrl: z.string().optional(),
  confidence: ServicePricingConfidenceSchema.optional(),
  /** ISO datetime the price was retrieved from the web (cache write time for hits). */
  retrievedAt: z.string().optional(),
  /** True when served from the DynamoDB cache rather than a live lookup. */
  fromCache: z.boolean(),
});

export type ServicePricingResult = z.infer<typeof ServicePricingResultSchema>;
