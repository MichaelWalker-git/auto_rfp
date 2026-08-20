import { describe, it, expect } from 'vitest';
import {
  ServicePricingBillingPeriodSchema,
  ServicePricingCacheCreateRequestSchema,
  ServicePricingCacheDBItemSchema,
  ServicePricingCacheItemSchema,
  ServicePricingCacheListItemSchema,
  ServicePricingCacheUpdateRequestSchema,
  ServicePricingConfidenceSchema,
  ServicePricingExtractionSchema,
  ServicePricingLookupSchema,
  ServicePricingResultSchema,
} from './service-pricing-cache';
import { PK_NAME, SK_NAME } from '../constants';

describe('ServicePricingBillingPeriodSchema', () => {
  it.each(['MONTHLY', 'ANNUAL', 'ONE_TIME', 'USAGE_BASED', 'UNKNOWN'])(
    'accepts %s',
    (period) => {
      expect(ServicePricingBillingPeriodSchema.safeParse(period).success).toBe(true);
    },
  );

  it('rejects unknown values', () => {
    expect(ServicePricingBillingPeriodSchema.safeParse('WEEKLY').success).toBe(false);
  });
});

describe('ServicePricingConfidenceSchema', () => {
  it('accepts HIGH/MEDIUM/LOW and rejects others', () => {
    expect(ServicePricingConfidenceSchema.safeParse('HIGH').success).toBe(true);
    expect(ServicePricingConfidenceSchema.safeParse('LOW').success).toBe(true);
    expect(ServicePricingConfidenceSchema.safeParse('NONE').success).toBe(false);
  });
});

describe('ServicePricingLookupSchema', () => {
  it('accepts a name-only lookup (billingPeriod optional)', () => {
    expect(ServicePricingLookupSchema.safeParse({ serviceName: 'Datadog' }).success).toBe(true);
  });

  it('accepts an explicit billing period and rejects an invalid one', () => {
    expect(
      ServicePricingLookupSchema.safeParse({ serviceName: 'Datadog', billingPeriod: 'ANNUAL' }).success,
    ).toBe(true);
    expect(
      ServicePricingLookupSchema.safeParse({ serviceName: 'Datadog', billingPeriod: 'WEEKLY' }).success,
    ).toBe(false);
  });

  it('rejects an empty service name', () => {
    expect(ServicePricingLookupSchema.safeParse({ serviceName: '' }).success).toBe(false);
  });
});

describe('ServicePricingExtractionSchema', () => {
  it('accepts a full extraction', () => {
    const { success } = ServicePricingExtractionSchema.safeParse({
      serviceName: 'Datadog Pro',
      price: 23,
      currency: 'USD',
      unit: 'per host/month',
      tier: 'Pro',
      sourceUrl: 'https://www.datadoghq.com/pricing/',
      confidence: 'HIGH',
    });
    expect(success).toBe(true);
  });

  it('accepts a no-price extraction (LOW confidence)', () => {
    const { success } = ServicePricingExtractionSchema.safeParse({
      serviceName: 'Obscure SaaS',
      confidence: 'LOW',
    });
    expect(success).toBe(true);
  });

  it('rejects a negative price', () => {
    const { success } = ServicePricingExtractionSchema.safeParse({
      serviceName: 'Datadog Pro',
      price: -1,
      confidence: 'HIGH',
    });
    expect(success).toBe(false);
  });

  it('rejects a missing confidence', () => {
    const { success } = ServicePricingExtractionSchema.safeParse({
      serviceName: 'Datadog Pro',
      price: 23,
    });
    expect(success).toBe(false);
  });
});

describe('ServicePricingCacheCreateRequestSchema', () => {
  const valid = {
    serviceName: 'GitHub Enterprise Cloud',
    price: 21,
    currency: 'USD',
    unit: 'per user/month',
    confidence: 'HIGH',
    retrievedAt: '2026-08-14T00:00:00.000Z',
  };

  it('accepts a valid request and defaults billingPeriod to UNKNOWN', () => {
    const { success, data } = ServicePricingCacheCreateRequestSchema.safeParse(valid);
    expect(success).toBe(true);
    expect(data?.billingPeriod).toBe('UNKNOWN');
  });

  it('accepts an explicit billingPeriod', () => {
    const { success, data } = ServicePricingCacheCreateRequestSchema.safeParse({
      ...valid,
      billingPeriod: 'MONTHLY',
    });
    expect(success).toBe(true);
    expect(data?.billingPeriod).toBe('MONTHLY');
  });

  it('rejects a missing retrievedAt', () => {
    const { retrievedAt: _omitted, ...rest } = valid;
    expect(ServicePricingCacheCreateRequestSchema.safeParse(rest).success).toBe(false);
  });
});

describe('ServicePricingCacheUpdateRequestSchema', () => {
  it('accepts a partial patch', () => {
    const { success } = ServicePricingCacheUpdateRequestSchema.safeParse({ price: 42 });
    expect(success).toBe(true);
  });

  it('strips key fields (serviceName/billingPeriod are not patchable)', () => {
    const { success, data } = ServicePricingCacheUpdateRequestSchema.safeParse({
      serviceName: 'new-name',
      price: 42,
    });
    expect(success).toBe(true);
    expect(data).not.toHaveProperty('serviceName');
  });
});

describe('ServicePricingCacheItemSchema / DBItemSchema', () => {
  const item = {
    id: 'github enterprise cloud#MONTHLY',
    normalizedServiceName: 'github enterprise cloud',
    serviceName: 'GitHub Enterprise Cloud',
    billingPeriod: 'MONTHLY',
    price: 21,
    currency: 'USD',
    unit: 'per user/month',
    confidence: 'HIGH',
    retrievedAt: '2026-08-14T00:00:00.000Z',
    ttl: 1760000000,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  };

  it('accepts a valid item without db keys', () => {
    expect(ServicePricingCacheItemSchema.safeParse(item).success).toBe(true);
  });

  it('rejects a non-positive ttl', () => {
    expect(ServicePricingCacheItemSchema.safeParse({ ...item, ttl: 0 }).success).toBe(false);
  });

  it('DBItem requires the single-table keys', () => {
    expect(ServicePricingCacheDBItemSchema.safeParse(item).success).toBe(false);
    const { success } = ServicePricingCacheDBItemSchema.safeParse({
      ...item,
      [PK_NAME]: 'SERVICE_PRICING_CACHE',
      [SK_NAME]: 'github enterprise cloud#MONTHLY',
    });
    expect(success).toBe(true);
  });
});

describe('ServicePricingCacheListItemSchema', () => {
  it('accepts the lightweight projection', () => {
    const { success } = ServicePricingCacheListItemSchema.safeParse({
      id: 'datadog pro#UNKNOWN',
      serviceName: 'Datadog Pro',
      billingPeriod: 'UNKNOWN',
      confidence: 'LOW',
    });
    expect(success).toBe(true);
  });
});

describe('ServicePricingResultSchema', () => {
  it('accepts a found result', () => {
    const { success } = ServicePricingResultSchema.safeParse({
      serviceName: 'Datadog Pro',
      billingPeriod: 'MONTHLY',
      found: true,
      price: 23,
      currency: 'USD',
      unit: 'per host/month',
      sourceUrl: 'https://www.datadoghq.com/pricing/',
      confidence: 'HIGH',
      retrievedAt: '2026-08-14T00:00:00.000Z',
      fromCache: false,
    });
    expect(success).toBe(true);
  });

  it('accepts a not-found result with no price fields', () => {
    const { success } = ServicePricingResultSchema.safeParse({
      serviceName: 'Obscure SaaS',
      billingPeriod: 'UNKNOWN',
      found: false,
      fromCache: false,
    });
    expect(success).toBe(true);
  });

  it('rejects a missing fromCache flag', () => {
    const { success } = ServicePricingResultSchema.safeParse({
      serviceName: 'Obscure SaaS',
      billingPeriod: 'UNKNOWN',
      found: false,
    });
    expect(success).toBe(false);
  });
});
