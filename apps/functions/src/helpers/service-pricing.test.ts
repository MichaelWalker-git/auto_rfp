/**
 * Tests for the batched service pricing lookup (T2): cache hits/misses with
 * ttl enforcement, sequential web search, the single extraction pass,
 * confidence-tiered cache writes, and per-service degradation (never throws).
 */
const mockGetItem = jest.fn();
const mockPutItem = jest.fn();

jest.mock('@/helpers/db', () => ({
  getItem: (...a: unknown[]) => mockGetItem(...a),
  putItem: (...a: unknown[]) => mockPutItem(...a),
}));

const mockWebSearch = jest.fn();
jest.mock('@/helpers/web-search-client', () => ({
  webSearch: (...a: unknown[]) => mockWebSearch(...a),
}));

const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: (...a: unknown[]) => mockInvokeModel(...a),
}));

import {
  buildServicePricingCacheSk,
  normalizeServiceName,
  searchServicePricing,
} from './service-pricing';
import {
  MAX_SERVICE_PRICING_BATCH,
  SERVICE_PRICING_CACHE_PK,
  SERVICE_PRICING_LOW_CONFIDENCE_TTL_SECONDS,
  SERVICE_PRICING_TTL_SECONDS,
} from '@/constants/service-pricing';

const FUTURE_TTL = Math.floor(Date.now() / 1000) + 60 * 60;
const PAST_TTL = Math.floor(Date.now() / 1000) - 60;

const cachedItem = (overrides: Record<string, unknown> = {}) => ({
  id: 'datadog pro#MONTHLY',
  normalizedServiceName: 'datadog pro',
  serviceName: 'Datadog Pro',
  billingPeriod: 'MONTHLY',
  price: 23,
  currency: 'USD',
  unit: 'per host/month',
  confidence: 'HIGH',
  retrievedAt: '2026-08-01T00:00:00.000Z',
  ttl: FUTURE_TTL,
  ...overrides,
});

/** Bedrock response wrapping the given extraction entries. */
const extractionResponse = (services: unknown[]): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify({ services }) }],
    }),
  );

const webResults = [
  { title: 'Pricing | Datadog', url: 'https://www.datadoghq.com/pricing/', snippet: '$23 per host per month' },
];

describe('normalizeServiceName / buildServicePricingCacheSk', () => {
  it('trims, lowercases, and collapses whitespace', () => {
    expect(normalizeServiceName('  DataDog   Pro ')).toBe('datadog pro');
  });

  it('builds the {normalizedServiceName}#{billingPeriod} SK', () => {
    expect(buildServicePricingCacheSk('datadog pro', 'MONTHLY')).toBe('datadog pro#MONTHLY');
  });
});

describe('searchServicePricing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockResolvedValue(null);
    mockPutItem.mockResolvedValue({});
    mockWebSearch.mockResolvedValue(webResults);
  });

  it('serves a fresh cache hit without searching', async () => {
    mockGetItem.mockResolvedValue(cachedItem());

    const results = await searchServicePricing({
      services: [{ serviceName: 'Datadog Pro', billingPeriod: 'MONTHLY' }],
    });

    expect(mockGetItem).toHaveBeenCalledWith(SERVICE_PRICING_CACHE_PK, 'datadog pro#MONTHLY');
    expect(mockWebSearch).not.toHaveBeenCalled();
    expect(mockInvokeModel).not.toHaveBeenCalled();
    expect(results).toEqual([
      expect.objectContaining({
        serviceName: 'Datadog Pro',
        billingPeriod: 'MONTHLY',
        found: true,
        price: 23,
        fromCache: true,
      }),
    ]);
  });

  it('treats an expired ttl as a miss (DynamoDB deletes lazily)', async () => {
    mockGetItem.mockResolvedValue(cachedItem({ ttl: PAST_TTL }));
    mockInvokeModel.mockResolvedValue(
      extractionResponse([
        { serviceName: 'Datadog Pro', price: 27, currency: 'USD', sourceUrl: 'https://x', confidence: 'HIGH' },
      ]),
    );

    const results = await searchServicePricing({
      services: [{ serviceName: 'Datadog Pro', billingPeriod: 'MONTHLY' }],
    });

    expect(mockWebSearch).toHaveBeenCalledTimes(1);
    expect(results[0]).toEqual(
      expect.objectContaining({ found: true, price: 27, fromCache: false }),
    );
  });

  it('serves a cached LOW/no-price entry as found:false from cache', async () => {
    mockGetItem.mockResolvedValue(
      cachedItem({ price: undefined, currency: undefined, unit: undefined, confidence: 'LOW' }),
    );

    const results = await searchServicePricing({
      services: [{ serviceName: 'Datadog Pro', billingPeriod: 'MONTHLY' }],
    });

    expect(mockWebSearch).not.toHaveBeenCalled();
    expect(results[0]).toEqual(
      expect.objectContaining({ found: false, fromCache: true, confidence: 'LOW' }),
    );
  });

  it('searches each miss sequentially but extracts in ONE model call', async () => {
    mockInvokeModel.mockResolvedValue(
      extractionResponse([
        { serviceName: 'Datadog Pro', price: 23, currency: 'USD', unit: 'per host/month', sourceUrl: 'https://x', confidence: 'HIGH' },
        { serviceName: 'GitHub Enterprise', price: 21, currency: 'USD', sourceUrl: 'https://y', confidence: 'MEDIUM' },
      ]),
    );

    const results = await searchServicePricing({
      services: [
        { serviceName: 'Datadog Pro', billingPeriod: 'MONTHLY' },
        { serviceName: 'GitHub Enterprise' },
      ],
    });

    expect(mockWebSearch).toHaveBeenCalledTimes(2);
    expect(mockInvokeModel).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(2);
    expect(results[0]).toEqual(expect.objectContaining({ found: true, price: 23, fromCache: false }));
    expect(results[1]).toEqual(
      expect.objectContaining({ serviceName: 'GitHub Enterprise', billingPeriod: 'UNKNOWN', found: true, price: 21 }),
    );
  }, 15000);

  it('includes the service name and pricing terms in the search query', async () => {
    mockInvokeModel.mockResolvedValue(extractionResponse([]));

    await searchServicePricing({
      services: [{ serviceName: 'Datadog Pro', billingPeriod: 'MONTHLY' }],
    });

    expect(mockWebSearch).toHaveBeenCalledWith(
      expect.stringContaining('Datadog Pro pricing'),
      expect.anything(),
    );
  });

  it('writes HIGH-confidence extractions with the 30-day ttl', async () => {
    mockInvokeModel.mockResolvedValue(
      extractionResponse([
        { serviceName: 'Datadog Pro', price: 23, currency: 'USD', sourceUrl: 'https://x', confidence: 'HIGH' },
      ]),
    );

    await searchServicePricing({ services: [{ serviceName: 'Datadog Pro' }] });

    expect(mockPutItem).toHaveBeenCalledTimes(1);
    const [pk, sk, item] = mockPutItem.mock.calls[0];
    expect(pk).toBe(SERVICE_PRICING_CACHE_PK);
    expect(sk).toBe('datadog pro#UNKNOWN');
    expect(item.confidence).toBe('HIGH');
    const nowEpoch = Math.floor(Date.now() / 1000);
    expect(item.ttl).toBeGreaterThan(nowEpoch + SERVICE_PRICING_TTL_SECONDS - 60);
    expect(item.ttl).toBeLessThanOrEqual(nowEpoch + SERVICE_PRICING_TTL_SECONDS + 60);
  });

  it('writes LOW-confidence (no price) extractions with the ~24h ttl', async () => {
    mockInvokeModel.mockResolvedValue(
      extractionResponse([{ serviceName: 'Obscure SaaS', confidence: 'LOW' }]),
    );

    const results = await searchServicePricing({ services: [{ serviceName: 'Obscure SaaS' }] });

    expect(results[0]).toEqual(expect.objectContaining({ found: false, confidence: 'LOW' }));
    const [, , item] = mockPutItem.mock.calls[0];
    const nowEpoch = Math.floor(Date.now() / 1000);
    expect(item.ttl).toBeGreaterThan(nowEpoch + SERVICE_PRICING_LOW_CONFIDENCE_TTL_SECONDS - 60);
    expect(item.ttl).toBeLessThanOrEqual(nowEpoch + SERVICE_PRICING_LOW_CONFIDENCE_TTL_SECONDS + 60);
  });

  it('degrades a price with no source to found:false LOW (never serve unverifiable prices)', async () => {
    mockInvokeModel.mockResolvedValue(
      extractionResponse([{ serviceName: 'Datadog Pro', price: 23, confidence: 'HIGH' }]),
    );

    const results = await searchServicePricing({ services: [{ serviceName: 'Datadog Pro' }] });

    expect(results[0]).toEqual(expect.objectContaining({ found: false, confidence: 'LOW' }));
  });

  it('degrades only the failed service when one web search throws', async () => {
    mockWebSearch
      .mockRejectedValueOnce(new Error('brave down'))
      .mockResolvedValueOnce(webResults);
    mockInvokeModel.mockResolvedValue(
      extractionResponse([
        { serviceName: 'GitHub Enterprise', price: 21, currency: 'USD', sourceUrl: 'https://y', confidence: 'HIGH' },
      ]),
    );

    const results = await searchServicePricing({
      services: [{ serviceName: 'Datadog Pro' }, { serviceName: 'GitHub Enterprise' }],
    });

    expect(results[0]).toEqual(
      expect.objectContaining({ serviceName: 'Datadog Pro', found: false, fromCache: false }),
    );
    expect(results[1]).toEqual(expect.objectContaining({ found: true, price: 21 }));
    // Only the successful extraction is cached
    expect(mockPutItem).toHaveBeenCalledTimes(1);
  }, 15000);

  it('degrades ALL misses when the extraction call fails (total outage shape, ADR-15)', async () => {
    mockInvokeModel.mockRejectedValue(new Error('bedrock down'));

    const results = await searchServicePricing({
      services: [{ serviceName: 'Datadog Pro' }, { serviceName: 'GitHub Enterprise' }],
    });

    expect(results).toHaveLength(2);
    expect(results.every((r) => r.found === false && r.fromCache === false)).toBe(true);
    expect(mockPutItem).not.toHaveBeenCalled();
  }, 15000);

  it('degrades a service the model skipped without caching it', async () => {
    mockInvokeModel.mockResolvedValue(
      extractionResponse([
        { serviceName: 'Datadog Pro', price: 23, currency: 'USD', sourceUrl: 'https://x', confidence: 'HIGH' },
      ]),
    );

    const results = await searchServicePricing({
      services: [{ serviceName: 'Datadog Pro' }, { serviceName: 'GitHub Enterprise' }],
    });

    expect(results[1]).toEqual(
      expect.objectContaining({ serviceName: 'GitHub Enterprise', found: false }),
    );
    expect(mockPutItem).toHaveBeenCalledTimes(1);
  }, 15000);

  it('treats a failed cache read as a miss instead of throwing', async () => {
    mockGetItem.mockRejectedValue(new Error('ddb down'));
    mockInvokeModel.mockResolvedValue(
      extractionResponse([
        { serviceName: 'Datadog Pro', price: 23, currency: 'USD', sourceUrl: 'https://x', confidence: 'HIGH' },
      ]),
    );

    const results = await searchServicePricing({ services: [{ serviceName: 'Datadog Pro' }] });

    expect(results[0]).toEqual(expect.objectContaining({ found: true, price: 23 }));
  });

  it('still returns the result when the cache write fails', async () => {
    mockPutItem.mockRejectedValue(new Error('ddb down'));
    mockInvokeModel.mockResolvedValue(
      extractionResponse([
        { serviceName: 'Datadog Pro', price: 23, currency: 'USD', sourceUrl: 'https://x', confidence: 'HIGH' },
      ]),
    );

    const results = await searchServicePricing({ services: [{ serviceName: 'Datadog Pro' }] });

    expect(results[0]).toEqual(expect.objectContaining({ found: true, price: 23 }));
  });

  it('de-duplicates services that normalize to the same cache key', async () => {
    mockGetItem.mockResolvedValue(cachedItem({ billingPeriod: 'UNKNOWN' }));

    const results = await searchServicePricing({
      services: [{ serviceName: 'Datadog Pro' }, { serviceName: '  datadog   pro ' }],
    });

    expect(mockGetItem).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(1);
  });

  it('drops blank service names', async () => {
    const results = await searchServicePricing({ services: [{ serviceName: '   ' }] });
    expect(results).toEqual([]);
    expect(mockGetItem).not.toHaveBeenCalled();
  });

  it(`caps the batch at ${MAX_SERVICE_PRICING_BATCH} services`, async () => {
    mockGetItem.mockResolvedValue(cachedItem());

    const services = Array.from({ length: MAX_SERVICE_PRICING_BATCH + 2 }, (_, i) => ({
      serviceName: `Service ${i}`,
    }));
    const results = await searchServicePricing({ services });

    expect(results).toHaveLength(MAX_SERVICE_PRICING_BATCH);
    expect(mockGetItem).toHaveBeenCalledTimes(MAX_SERVICE_PRICING_BATCH);
  });
});
