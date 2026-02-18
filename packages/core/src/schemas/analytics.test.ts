import { describe, it, expect } from 'vitest';
import {
  MonthlyAnalyticsSchema,
  AnalyticsSummarySchema,
  GetAnalyticsRequestSchema,
  GetAnalyticsResponseSchema,
  OrgAnalyticsSchema,
  GlobalAnalyticsResponseSchema,
  LossReasonBreakdownSchema,
  ExportFormatSchema,
  ExportAnalyticsRequestSchema,
  RecalculateAnalyticsRequestSchema,
  formatMonth,
  getMonthsInRange,
  calculateWinRate,
  calculateSubmissionRate,
  createEmptyMonthlyAnalytics,
} from './analytics';

describe('MonthlyAnalyticsSchema', () => {
  const validAnalytics = {
    orgId: 'org-123',
    month: '2025-01',
    totalProjects: 50,
    projectsSubmitted: 40,
    projectsWon: 15,
    projectsLost: 20,
    projectsNoBid: 5,
    projectsWithdrawn: 2,
    projectsPending: 8,
    totalPipelineValue: 5000000,
    totalWonValue: 2500000,
    totalLostValue: 3000000,
    averageContractValue: 166666.67,
    averageTimeToSubmit: 12.5,
    averageTimeToDecision: 45.3,
    lossReasonCounts: {
      PRICE_TOO_HIGH: 8,
      INCUMBENT_ADVANTAGE: 5,
      TECHNICAL_SCORE: 4,
      OTHER: 3,
    },
    winRate: 42.86,
    submissionRate: 80,
    foiaRequestsGenerated: 5,
    foiaResponsesReceived: 2,
    calculatedAt: '2025-01-28T10:00:00Z',
    projectIds: ['proj-1', 'proj-2', 'proj-3'],
  };

  it('validates complete analytics record', () => {
    const result = MonthlyAnalyticsSchema.safeParse(validAnalytics);
    expect(result.success).toBe(true);
  });

  it('requires month in YYYY-MM format', () => {
    const invalidMonth = { ...validAnalytics, month: '2025-1' };
    expect(MonthlyAnalyticsSchema.safeParse(invalidMonth).success).toBe(false);

    const invalidMonth2 = { ...validAnalytics, month: '01-2025' };
    expect(MonthlyAnalyticsSchema.safeParse(invalidMonth2).success).toBe(false);

    const invalidMonth3 = { ...validAnalytics, month: '2025/01' };
    expect(MonthlyAnalyticsSchema.safeParse(invalidMonth3).success).toBe(false);
  });

  it('rejects negative values for counts', () => {
    const negativeCount = { ...validAnalytics, totalProjects: -1 };
    expect(MonthlyAnalyticsSchema.safeParse(negativeCount).success).toBe(false);
  });

  it('validates winRate is between 0 and 100', () => {
    const validWinRate = { ...validAnalytics, winRate: 0 };
    expect(MonthlyAnalyticsSchema.safeParse(validWinRate).success).toBe(true);

    const validWinRate100 = { ...validAnalytics, winRate: 100 };
    expect(MonthlyAnalyticsSchema.safeParse(validWinRate100).success).toBe(true);

    const invalidWinRate = { ...validAnalytics, winRate: 150 };
    expect(MonthlyAnalyticsSchema.safeParse(invalidWinRate).success).toBe(false);

    const negativeWinRate = { ...validAnalytics, winRate: -10 };
    expect(MonthlyAnalyticsSchema.safeParse(negativeWinRate).success).toBe(false);
  });

  it('requires valid datetime for calculatedAt', () => {
    const invalidDate = { ...validAnalytics, calculatedAt: 'not-a-date' };
    expect(MonthlyAnalyticsSchema.safeParse(invalidDate).success).toBe(false);
  });
});

describe('AnalyticsSummarySchema', () => {
  const validSummary = {
    totalProjects: 200,
    totalSubmitted: 160,
    totalWon: 60,
    totalLost: 80,
    totalNoBid: 20,
    totalPipelineValue: 20000000,
    totalWonValue: 10000000,
    totalLostValue: 12000000,
    averageContractValue: 166666.67,
    winRate: 42.86,
    submissionRate: 80,
    averageTimeToSubmit: 12.5,
    averageTimeToDecision: 45.3,
    lossReasonCounts: {
      PRICE_TOO_HIGH: 30,
      INCUMBENT_ADVANTAGE: 25,
      TECHNICAL_SCORE: 15,
      OTHER: 10,
    },
    topLossReason: 'PRICE_TOO_HIGH',
    periodStart: '2024-01',
    periodEnd: '2025-01',
    monthCount: 13,
  };

  it('validates complete summary', () => {
    const result = AnalyticsSummarySchema.safeParse(validSummary);
    expect(result.success).toBe(true);
  });

  it('allows missing topLossReason', () => {
    const { topLossReason, ...withoutTop } = validSummary;
    const result = AnalyticsSummarySchema.safeParse(withoutTop);
    expect(result.success).toBe(true);
  });

  it('validates period format', () => {
    const invalidPeriod = { ...validSummary, periodStart: '2024-1' };
    expect(AnalyticsSummarySchema.safeParse(invalidPeriod).success).toBe(false);
  });
});

describe('GetAnalyticsRequestSchema', () => {
  it('validates valid request', () => {
    const request = {
      orgId: 'org-123',
      startMonth: '2024-01',
      endMonth: '2025-01',
    };

    const result = GetAnalyticsRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it('rejects invalid month format', () => {
    const request = {
      orgId: 'org-123',
      startMonth: '2024-1',
      endMonth: '2025-01',
    };

    const result = GetAnalyticsRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });

  it('rejects startMonth after endMonth', () => {
    const request = {
      orgId: 'org-123',
      startMonth: '2025-06',
      endMonth: '2025-01',
    };

    const result = GetAnalyticsRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });

  it('allows same startMonth and endMonth', () => {
    const request = {
      orgId: 'org-123',
      startMonth: '2025-01',
      endMonth: '2025-01',
    };

    const result = GetAnalyticsRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it('requires orgId', () => {
    const request = {
      startMonth: '2024-01',
      endMonth: '2025-01',
    };

    const result = GetAnalyticsRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });
});

describe('OrgAnalyticsSchema', () => {
  it('validates org analytics', () => {
    const orgAnalytics = {
      orgId: 'org-123',
      orgName: 'VRC Shred',
      totalProjects: 50,
      projectsWon: 20,
      projectsLost: 25,
      winRate: 44.44,
      totalWonValue: 5000000,
      totalPipelineValue: 3000000,
    };

    const result = OrgAnalyticsSchema.safeParse(orgAnalytics);
    expect(result.success).toBe(true);
  });
});

describe('LossReasonBreakdownSchema', () => {
  it('validates loss reason breakdown', () => {
    const breakdown = {
      orgId: 'org-123',
      periodStart: '2024-01',
      periodEnd: '2025-01',
      totalLosses: 80,
      breakdown: [
        { reason: 'PRICE_TOO_HIGH', count: 30, percentage: 37.5, totalValue: 4500000 },
        { reason: 'INCUMBENT_ADVANTAGE', count: 25, percentage: 31.25, totalValue: 3750000 },
        { reason: 'TECHNICAL_SCORE', count: 15, percentage: 18.75, totalValue: 2250000 },
        { reason: 'OTHER', count: 10, percentage: 12.5, totalValue: 1500000 },
      ],
    };

    const result = LossReasonBreakdownSchema.safeParse(breakdown);
    expect(result.success).toBe(true);
  });
});

describe('ExportFormatSchema', () => {
  it('accepts PDF and CSV', () => {
    expect(ExportFormatSchema.safeParse('PDF').success).toBe(true);
    expect(ExportFormatSchema.safeParse('CSV').success).toBe(true);
  });

  it('rejects invalid formats', () => {
    expect(ExportFormatSchema.safeParse('XLSX').success).toBe(false);
    expect(ExportFormatSchema.safeParse('pdf').success).toBe(false);
  });
});

describe('ExportAnalyticsRequestSchema', () => {
  it('validates valid export request', () => {
    const request = {
      orgId: 'org-123',
      format: 'PDF',
      startMonth: '2024-01',
      endMonth: '2025-01',
    };

    const result = ExportAnalyticsRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it('requires all fields', () => {
    const request = {
      orgId: 'org-123',
      format: 'CSV',
    };

    const result = ExportAnalyticsRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });
});

describe('RecalculateAnalyticsRequestSchema', () => {
  it('validates request with specific month', () => {
    const request = {
      orgId: 'org-123',
      month: '2025-01',
    };

    const result = RecalculateAnalyticsRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it('allows missing month (recalculate all)', () => {
    const request = {
      orgId: 'org-123',
    };

    const result = RecalculateAnalyticsRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });
});

describe('formatMonth', () => {
  it('formats date to YYYY-MM', () => {
    expect(formatMonth(new Date('2025-01-15'))).toBe('2025-01');
    expect(formatMonth(new Date('2025-12-31'))).toBe('2025-12');
    expect(formatMonth(new Date('2024-06-01'))).toBe('2024-06');
  });

  it('pads single-digit months with zero', () => {
    expect(formatMonth(new Date('2025-01-15'))).toBe('2025-01');
    expect(formatMonth(new Date('2025-09-15'))).toBe('2025-09');
  });
});

describe('getMonthsInRange', () => {
  it('returns single month for same start and end', () => {
    const months = getMonthsInRange('2025-01', '2025-01');
    expect(months).toEqual(['2025-01']);
  });

  it('returns correct months for same year range', () => {
    const months = getMonthsInRange('2025-01', '2025-04');
    expect(months).toEqual(['2025-01', '2025-02', '2025-03', '2025-04']);
  });

  it('handles year boundary correctly', () => {
    const months = getMonthsInRange('2024-11', '2025-02');
    expect(months).toEqual(['2024-11', '2024-12', '2025-01', '2025-02']);
  });

  it('returns full year', () => {
    const months = getMonthsInRange('2024-01', '2024-12');
    expect(months.length).toBe(12);
    expect(months[0]).toBe('2024-01');
    expect(months[11]).toBe('2024-12');
  });
});

describe('calculateWinRate', () => {
  it('calculates correct win rate', () => {
    expect(calculateWinRate(15, 35)).toBeCloseTo(30);
    expect(calculateWinRate(20, 20)).toBeCloseTo(50);
    expect(calculateWinRate(50, 0)).toBeCloseTo(100);
  });

  it('returns 0 for no decisions', () => {
    expect(calculateWinRate(0, 0)).toBe(0);
  });

  it('returns 0 for no wins', () => {
    expect(calculateWinRate(0, 50)).toBe(0);
  });
});

describe('calculateSubmissionRate', () => {
  it('calculates correct submission rate', () => {
    expect(calculateSubmissionRate(40, 50)).toBeCloseTo(80);
    expect(calculateSubmissionRate(50, 100)).toBeCloseTo(50);
    expect(calculateSubmissionRate(100, 100)).toBeCloseTo(100);
  });

  it('returns 0 for no projects', () => {
    expect(calculateSubmissionRate(0, 0)).toBe(0);
  });

  it('returns 0 for no submissions', () => {
    expect(calculateSubmissionRate(0, 50)).toBe(0);
  });
});

describe('createEmptyMonthlyAnalytics', () => {
  it('creates empty analytics with correct structure', () => {
    const analytics = createEmptyMonthlyAnalytics('org-123', '2025-01');

    expect(analytics.orgId).toBe('org-123');
    expect(analytics.month).toBe('2025-01');
    expect(analytics.totalProjects).toBe(0);
    expect(analytics.projectsSubmitted).toBe(0);
    expect(analytics.projectsWon).toBe(0);
    expect(analytics.projectsLost).toBe(0);
    expect(analytics.winRate).toBe(0);
    expect(analytics.submissionRate).toBe(0);
    expect(analytics.projectIds).toEqual([]);
  });

  it('validates against schema', () => {
    const analytics = createEmptyMonthlyAnalytics('org-123', '2025-01');
    const result = MonthlyAnalyticsSchema.safeParse(analytics);
    expect(result.success).toBe(true);
  });
});
