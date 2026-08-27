import { describe, expect, it } from 'vitest';

import {
  FOIA_OUTCOME_BUCKET_LABELS,
  FOIA_PRICING_CHART_LIMIT,
  FoiaDashboardResponseSchema,
  FoiaOutcomeBucketSchema,
  FoiaPricingComparisonSchema,
  resolveFoiaOutcomeBucket,
} from './foia-dashboard';

describe('resolveFoiaOutcomeBucket', () => {
  const bucket = (
    automationState: string | null,
    responseOutcome: string | null,
    opportunityStatus: string | null,
  ) =>
    resolveFoiaOutcomeBucket({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      automationState: automationState as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      responseOutcome: responseOutcome as any,
      opportunityStatus,
    });

  it('buckets a recorded win', () => {
    expect(bucket('SENT', 'RECORDS_RECEIVED', 'WON')).toBe('WON');
  });

  it('buckets a recorded loss', () => {
    expect(bucket('SENT', 'RECORDS_RECEIVED', 'LOST')).toBe('LOST');
  });

  /**
   * The precedence cases. These are the reason this is a function and not a lookup on
   * `status`: a cancelled or no-records opportunity is STILL WON/LOST on its own
   * record, because the outcome field is never cleared. Checking status first would
   * make two of the four buckets permanently empty while over-counting Lost.
   */
  it('prefers CANCELLED over the recorded outcome', () => {
    expect(bucket('SUPPRESSED', null, 'LOST')).toBe('CANCELLED');
    expect(bucket('SUPPRESSED', null, 'WON')).toBe('CANCELLED');
  });

  it('prefers NOT_PRESENT over the recorded outcome', () => {
    expect(bucket('SENT', 'NO_RECORDS_LOCATED', 'LOST')).toBe('NOT_PRESENT');
    expect(bucket('SENT', 'NO_RECORDS_LOCATED', 'WON')).toBe('NOT_PRESENT');
  });

  it('prefers CANCELLED over NOT_PRESENT', () => {
    // The solicitation going away outranks what the agency held for it.
    expect(bucket('SUPPRESSED', 'NO_RECORDS_LOCATED', 'LOST')).toBe('CANCELLED');
  });

  it('buckets a cancellation even with no recorded outcome', () => {
    expect(bucket('SUPPRESSED', null, null)).toBe('CANCELLED');
  });

  it('returns null for an opportunity with no terminal outcome', () => {
    // Not on this dashboard at all — it has nothing to compare yet.
    expect(bucket('SCHEDULED', null, 'IN_PROGRESS')).toBeNull();
    expect(bucket('SCHEDULED', null, null)).toBeNull();
    expect(bucket(null, null, 'SUBMITTED')).toBeNull();
  });

  it('does not bucket other response outcomes as NOT_PRESENT', () => {
    // Only "no records located" means the agency holds nothing. A denial or an
    // acknowledgement is a different fact and must not be merged into it.
    expect(bucket('SENT', 'DENIED', 'LOST')).toBe('LOST');
    expect(bucket('SENT', 'ACKNOWLEDGED', 'LOST')).toBe('LOST');
    expect(bucket('SENT', 'RECORDS_RECEIVED', 'LOST')).toBe('LOST');
  });

  it('tolerates a missing automation entirely', () => {
    // An opportunity can have an outcome with no FOIA automation record yet.
    expect(bucket(null, null, 'LOST')).toBe('LOST');
  });
});

describe('FOIA_OUTCOME_BUCKET_LABELS', () => {
  it('labels every bucket', () => {
    for (const value of FoiaOutcomeBucketSchema.options) {
      expect(FOIA_OUTCOME_BUCKET_LABELS[value]).toBeTruthy();
    }
  });
});

describe('FoiaPricingComparisonSchema', () => {
  const valid = {
    oppId: 'opp-1',
    projectId: 'proj-1',
    title: 'Student Prospect Digital Profile Solution',
    hasPricing: true,
    ourBidAmount: 250_000,
    winningBidAmount: 198_500,
  };

  it('accepts a chartable row', () => {
    const { success, data } = FoiaPricingComparisonSchema.safeParse(valid);

    expect(success).toBe(true);
    expect(data?.hasPricing).toBe(true);
  });

  it('accepts a row with no pricing recorded', () => {
    // The common case: a real FOIA outcome where nobody filled in the loss form.
    const { success, data } = FoiaPricingComparisonSchema.safeParse({
      oppId: 'opp-2',
      projectId: 'proj-1',
      title: 'Lifeguard Dispatch Software Services',
      hasPricing: false,
    });

    expect(success).toBe(true);
    expect(data?.ourBidAmount).toBeUndefined();
    expect(data?.winningBidAmount).toBeUndefined();
  });

  it('requires hasPricing to be explicit', () => {
    const { hasPricing: _omitted, ...withoutFlag } = valid;

    expect(FoiaPricingComparisonSchema.safeParse(withoutFlag).success).toBe(false);
  });

  it('rejects a negative amount', () => {
    expect(
      FoiaPricingComparisonSchema.safeParse({ ...valid, ourBidAmount: -1 }).success,
    ).toBe(false);
  });
});

describe('FoiaDashboardResponseSchema', () => {
  const valid = {
    orgId: 'org-1',
    counts: { WON: 1, LOST: 4, NOT_PRESENT: 1, CANCELLED: 2 },
    pricing: [],
    pricingCoverage: { withPricing: 0, total: 8 },
    scores: [],
    documentCount: 3,
    sentCount: 5,
    responseOutcomeCounts: { RECORDS_RECEIVED: 2, NO_RECORDS_LOCATED: 1 },
    calculatedAt: '2026-08-13T21:00:00.000Z',
  };

  it('accepts a full response', () => {
    expect(FoiaDashboardResponseSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts an org with nothing tracked yet', () => {
    // An empty org must produce zeroed counts, not an error — the dashboard renders
    // an empty state rather than failing.
    const { success } = FoiaDashboardResponseSchema.safeParse({
      ...valid,
      counts: { WON: 0, LOST: 0, NOT_PRESENT: 0, CANCELLED: 0 },
      pricingCoverage: { withPricing: 0, total: 0 },
      documentCount: 0,
      sentCount: 0,
      responseOutcomeCounts: {},
    });

    expect(success).toBe(true);
  });

  it('requires every bucket in counts', () => {
    const { CANCELLED: _dropped, ...partial } = valid.counts;

    expect(
      FoiaDashboardResponseSchema.safeParse({ ...valid, counts: partial }).success,
    ).toBe(false);
  });

  it('rejects a fractional count', () => {
    expect(
      FoiaDashboardResponseSchema.safeParse({
        ...valid,
        counts: { ...valid.counts, WON: 1.5 },
      }).success,
    ).toBe(false);
  });

  it('caps the chart at five rows per the requirement', () => {
    expect(FOIA_PRICING_CHART_LIMIT).toBe(5);
  });
});
