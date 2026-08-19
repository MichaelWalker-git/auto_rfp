/**
 * service-pricing.ts
 *
 * Batched third-party service price lookups with a DynamoDB cache (T2).
 *
 * Flow per batch (max 10 services — the tool schema cap):
 *   1. Normalize each service to its cache key and read the cache.
 *   2. For misses, web-search each service SEQUENTIALLY (Brave free tier is
 *      1 req/sec — batched because Brave can't combine services in one query,
 *      while doc generation allows only 2 tool rounds per section, so all
 *      prices must come back in a single call).
 *   3. ONE Haiku extraction pass over all collected results →
 *      `{price, currency, unit, tier, sourceUrl, confidence}` per service
 *      (LOW confidence when no price is stated).
 *   4. Cache writes with confidence-tiered `ttl`: HIGH/MEDIUM 30 days,
 *      LOW ~24h so bad lookups self-heal (ADR-9).
 *
 * Failures degrade per service (`found: false`) — this helper never throws
 * for a lookup problem, so the tool executor (T3, ADR-15) can render
 * "vendor quote required" rows and the document always completes.
 */

import type {
  ServicePricingBillingPeriod,
  ServicePricingCacheDBItem,
  ServicePricingExtraction,
  ServicePricingLookup,
  ServicePricingResult,
} from '@auto-rfp/core';
import { ServicePricingExtractionSchema } from '@auto-rfp/core';
import { z } from 'zod';

import { getItem, putItem } from '@/helpers/db';
import { invokeModel } from '@/helpers/bedrock-http-client';
import { webSearch, type WebSearchResult } from '@/helpers/web-search-client';
import { safeParseJsonFromModel } from '@/helpers/json';
import { nowIso } from '@/helpers/date';
import { requireEnv } from '@/helpers/env';
import { sleep } from '@/helpers/sleep';
import {
  MAX_SERVICE_PRICING_BATCH,
  SERVICE_PRICING_CACHE_PK,
  SERVICE_PRICING_LOW_CONFIDENCE_TTL_SECONDS,
  SERVICE_PRICING_TTL_SECONDS,
} from '@/constants/service-pricing';

/** Spacing between sequential Brave calls — free tier allows 1 req/sec. */
const SEARCH_SPACING_MS = 1100;

/** Web results fed to the extraction pass, per service. */
const SEARCH_RESULT_COUNT = 5;

const resolveExtractionModelId = (): string =>
  requireEnv('SERVICE_PRICING_MODEL_ID', 'us.anthropic.claude-haiku-4-5-20251001-v1:0');

export type { ServicePricingLookup };

// ─── Key builders ───────────────────────────────────────────────────────────────

/** Normalize a service name for the cache key: trim, lowercase, collapse whitespace. */
export const normalizeServiceName = (serviceName: string): string =>
  serviceName.trim().toLowerCase().replace(/\s+/g, ' ');

/** SK: `{normalizedServiceName}#{billingPeriod}` — global scope, no orgId. */
export const buildServicePricingCacheSk = (
  normalizedServiceName: string,
  billingPeriod: ServicePricingBillingPeriod,
): string => `${normalizedServiceName}#${billingPeriod}`;

// ─── Cache ──────────────────────────────────────────────────────────────────────

type ResolvedLookup = {
  serviceName: string;
  normalizedServiceName: string;
  billingPeriod: ServicePricingBillingPeriod;
  sk: string;
};

/**
 * Read a cache entry, treating expired records as misses — DynamoDB deletes
 * TTL'd items lazily (up to ~48h late), so the read must enforce the ttl.
 */
const getCachedEntry = async (sk: string): Promise<ServicePricingCacheDBItem | null> => {
  const item = await getItem<ServicePricingCacheDBItem>(SERVICE_PRICING_CACHE_PK, sk);
  if (!item) return null;
  const nowEpoch = Math.floor(Date.now() / 1000);
  return item.ttl > nowEpoch ? item : null;
};

const writeCacheEntry = async (
  lookup: ResolvedLookup,
  extraction: ServicePricingExtraction,
  retrievedAt: string,
): Promise<void> => {
  const ttlSeconds =
    extraction.confidence === 'LOW'
      ? SERVICE_PRICING_LOW_CONFIDENCE_TTL_SECONDS
      : SERVICE_PRICING_TTL_SECONDS;

  await putItem(SERVICE_PRICING_CACHE_PK, lookup.sk, {
    id: lookup.sk,
    normalizedServiceName: lookup.normalizedServiceName,
    serviceName: lookup.serviceName,
    billingPeriod: lookup.billingPeriod,
    price: extraction.price,
    currency: extraction.currency,
    unit: extraction.unit,
    tier: extraction.tier,
    sourceUrl: extraction.sourceUrl,
    confidence: extraction.confidence,
    retrievedAt,
    ttl: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
};

// ─── Extraction (one Haiku pass over all searched services) ─────────────────────

/** A cache miss together with the web results its extraction will read. */
type SearchedLookup = { lookup: ResolvedLookup; results: WebSearchResult[] };

/** Bedrock invoke-response envelope — only what we read. */
const BedrockResponseEnvelopeSchema = z.object({
  content: z
    .array(z.object({ type: z.string(), text: z.string().optional() }).passthrough())
    .optional(),
});

const ExtractionResponseSchema = z.object({
  services: z.array(ServicePricingExtractionSchema),
});

const EXTRACTION_SYSTEM_PROMPT = `You extract third-party service pricing facts from web search results.

Rules:
- NEVER invent a price. Only report a price explicitly stated in a snippet or title.
- Report the public list price for the closest matching plan/tier.
- confidence: HIGH = price on an official vendor pricing page; MEDIUM = price stated on a third-party source; LOW = no price stated anywhere (omit the price field entirely).
- sourceUrl must be the URL of the result the price came from.
- Respond with ONLY a JSON object: {"services": [{"serviceName", "price"?, "currency"?, "unit"?, "tier"?, "sourceUrl"?, "confidence"}]}
- Include exactly one entry per requested service, with serviceName copied verbatim from the request.`;

const buildExtractionUserPrompt = (searched: SearchedLookup[]): string => {
  const sections = searched.map(({ lookup, results }) => {
    const resultLines = results.length
      ? results
          .map((r, i) => `  ${i + 1}. ${r.title}\n     URL: ${r.url}\n     ${r.snippet}`)
          .join('\n')
      : '  (no search results)';
    return `Service: ${lookup.serviceName} (billing period: ${lookup.billingPeriod})\nSearch results:\n${resultLines}`;
  });

  return `Extract pricing for each of the following services from their search results.\n\n${sections.join('\n\n')}`;
};

/**
 * One extraction pass over all searched services. Returns extractions keyed
 * by normalized service name, or null when the model call/parse fails.
 */
const extractPrices = async (
  searched: SearchedLookup[],
): Promise<Map<string, ServicePricingExtraction> | null> => {
  try {
    const requestBody = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 4096,
      system: EXTRACTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildExtractionUserPrompt(searched) }],
    };

    const responseBody = await invokeModel(resolveExtractionModelId(), JSON.stringify(requestBody));
    const { success: envelopeOk, data: envelope } = BedrockResponseEnvelopeSchema.safeParse(
      JSON.parse(new TextDecoder('utf-8').decode(responseBody)),
    );
    const rawText = envelopeOk ? envelope.content?.find((c) => c.type === 'text')?.text : undefined;
    if (!rawText) return null;

    const modelOut = safeParseJsonFromModel(rawText);
    const { success, data } = ExtractionResponseSchema.safeParse(modelOut);
    if (!success) {
      console.warn('[service-pricing] extraction response failed validation, degrading batch');
      return null;
    }

    const byName = new Map<string, ServicePricingExtraction>();
    for (const extraction of data.services) {
      // A price with no stated source can't be verified — treat as not found.
      const sanitized: ServicePricingExtraction =
        extraction.price !== undefined && !extraction.sourceUrl
          ? { ...extraction, price: undefined, confidence: 'LOW' }
          : extraction;
      byName.set(normalizeServiceName(sanitized.serviceName), sanitized);
    }
    return byName;
  } catch (err) {
    console.warn('[service-pricing] extraction call failed, degrading batch:', err);
    return null;
  }
};

// ─── Public API ─────────────────────────────────────────────────────────────────

const toResult = (
  lookup: ResolvedLookup,
  fields: {
    price?: number;
    currency?: string;
    unit?: string;
    tier?: string;
    sourceUrl?: string;
    confidence?: ServicePricingResult['confidence'];
    retrievedAt?: string;
  },
  fromCache: boolean,
): ServicePricingResult => ({
  serviceName: lookup.serviceName,
  billingPeriod: lookup.billingPeriod,
  found: fields.price !== undefined,
  price: fields.price,
  currency: fields.currency,
  unit: fields.unit,
  tier: fields.tier,
  sourceUrl: fields.sourceUrl,
  confidence: fields.confidence,
  retrievedAt: fields.retrievedAt,
  fromCache,
});

const notFound = (lookup: ResolvedLookup): ServicePricingResult =>
  toResult(lookup, {}, false);

/**
 * Batched service pricing lookup: cache → sequential web search for misses →
 * one extraction pass → confidence-tiered cache writes. Returns one result
 * per input service (in input order): duplicates share their cache key's
 * result, and services beyond MAX_SERVICE_PRICING_BATCH degrade to
 * `found: false` rather than being dropped, so the tool executor (T3) can
 * always render a row per requested service. Never throws for lookup failures.
 */
export const searchServicePricing = async (args: {
  services: ServicePricingLookup[];
}): Promise<ServicePricingResult[]> => {
  // `resolved` keeps one entry per valid input service (duplicates included);
  // only `lookups` (de-duplicated, capped) is actually looked up.
  const resolved: ResolvedLookup[] = [];
  const seen = new Set<string>();
  const lookups: ResolvedLookup[] = [];
  let droppedOverCap = 0;
  for (const service of args.services) {
    const normalizedServiceName = normalizeServiceName(service.serviceName);
    if (!normalizedServiceName) continue;
    const billingPeriod = service.billingPeriod ?? 'UNKNOWN';
    const sk = buildServicePricingCacheSk(normalizedServiceName, billingPeriod);
    const lookup: ResolvedLookup = {
      serviceName: service.serviceName.trim(),
      normalizedServiceName,
      billingPeriod,
      sk,
    };
    resolved.push(lookup);
    if (seen.has(sk)) continue;
    if (lookups.length >= MAX_SERVICE_PRICING_BATCH) {
      droppedOverCap++;
      continue;
    }
    seen.add(sk);
    lookups.push(lookup);
  }

  if (droppedOverCap > 0) {
    console.warn(
      `[service-pricing] batch capped at ${MAX_SERVICE_PRICING_BATCH}; ${droppedOverCap} extra service(s) degraded to found:false`,
    );
  }

  const results = new Map<string, ServicePricingResult>();

  // 1. Cache reads (a failed read is a miss, not an error)
  const misses: ResolvedLookup[] = [];
  for (const lookup of lookups) {
    try {
      const cached = await getCachedEntry(lookup.sk);
      if (cached) {
        results.set(lookup.sk, toResult(lookup, cached, true));
        continue;
      }
    } catch (err) {
      console.warn(`[service-pricing] cache read failed for ${lookup.sk}, treating as miss:`, err);
    }
    misses.push(lookup);
  }

  // 2. Sequential web search for misses (1 req/sec)
  const searched: SearchedLookup[] = [];
  for (let i = 0; i < misses.length; i++) {
    const lookup = misses[i];
    if (i > 0) await sleep(SEARCH_SPACING_MS);
    try {
      const query = `${lookup.serviceName} pricing cost${
        lookup.billingPeriod !== 'UNKNOWN' ? ` ${lookup.billingPeriod.toLowerCase().replace('_', ' ')}` : ''
      }`;
      const webResults = await webSearch(query, { count: SEARCH_RESULT_COUNT });
      searched.push({ lookup, results: webResults });
    } catch (err) {
      console.warn(`[service-pricing] web search failed for "${lookup.serviceName}":`, err);
      results.set(lookup.sk, notFound(lookup));
    }
  }

  // 3. One extraction pass over everything that searched successfully
  if (searched.length > 0) {
    const extractions = await extractPrices(searched);
    const retrievedAt = nowIso();

    for (const { lookup } of searched) {
      const extraction = extractions?.get(lookup.normalizedServiceName);
      if (!extraction) {
        // Extraction failed or the model skipped this service — degrade, don't cache
        // (transient failures shouldn't poison the cache for 24h).
        results.set(lookup.sk, notFound(lookup));
        continue;
      }

      results.set(lookup.sk, toResult(lookup, { ...extraction, retrievedAt }, false));

      // 4. Confidence-tiered cache write (best effort)
      try {
        await writeCacheEntry(lookup, extraction, retrievedAt);
      } catch (err) {
        console.warn(`[service-pricing] cache write failed for ${lookup.sk}:`, err);
      }
    }
  }

  return resolved.map((lookup) => results.get(lookup.sk) ?? notFound(lookup));
};
