import { describe, it, expect } from 'vitest';
import {
  HistoricalRecordSchema,
  ImportHistoricalRequestSchema,
} from './project-outcome';
import {
  LossReasonCategorySchema,
  PeriodOfPerformanceSchema,
  WinDataSchema,
  LossDataSchema,
  EvaluationScoresSchema,
  LOSS_REASON_LABELS,
  type LossReasonCategory,
} from './outcome-detail';

describe('LossReasonCategorySchema', () => {
  it('accepts all valid loss reasons', () => {
    const validReasons: LossReasonCategory[] = [
      'PRICE_TOO_HIGH',
      'PRICE_TOO_LOW',
      'TECHNICAL_SCORE',
      'PAST_PERFORMANCE',
      'INCUMBENT_ADVANTAGE',
      'MISSING_CERTIFICATION',
      'LATE_SUBMISSION',
      'NON_COMPLIANT',
      'WITHDRAWN',
      'NO_BID_DECISION',
      'UNKNOWN',
      'OTHER',
    ];

    validReasons.forEach((reason) => {
      expect(LossReasonCategorySchema.safeParse(reason).success).toBe(true);
    });
  });

  it('rejects invalid loss reasons', () => {
    expect(LossReasonCategorySchema.safeParse('INVALID').success).toBe(false);
    expect(LossReasonCategorySchema.safeParse('').success).toBe(false);
    expect(LossReasonCategorySchema.safeParse(123).success).toBe(false);
  });
});

describe('PeriodOfPerformanceSchema', () => {
  it('validates valid period of performance', () => {
    const result = PeriodOfPerformanceSchema.safeParse({
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2026-01-01T00:00:00Z',
      optionYears: 2,
    });
    expect(result.success).toBe(true);
  });

  it('allows missing optionYears', () => {
    const result = PeriodOfPerformanceSchema.safeParse({
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid dates', () => {
    const result = PeriodOfPerformanceSchema.safeParse({
      startDate: 'not-a-date',
      endDate: '2026-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects optionYears greater than 10', () => {
    const result = PeriodOfPerformanceSchema.safeParse({
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2026-01-01T00:00:00Z',
      optionYears: 15,
    });
    expect(result.success).toBe(false);
  });
});

describe('WinDataSchema', () => {
  it('validates valid win data', () => {
    const result = WinDataSchema.safeParse({
      contractNumber: 'GS-35F-0001',
      contractValue: 1500000,
      awardDate: '2025-01-15T00:00:00Z',
      periodOfPerformance: {
        startDate: '2025-02-01T00:00:00Z',
        endDate: '2026-02-01T00:00:00Z',
      },
      competitorsBeaten: ['Acme Corp', 'TechSolutions'],
      keyFactors: 'Strong past performance and competitive pricing',
    });
    expect(result.success).toBe(true);
  });

  it('requires contractValue and awardDate', () => {
    const result = WinDataSchema.safeParse({
      contractValue: 500000,
      awardDate: '2025-01-15T00:00:00Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative contract value', () => {
    const result = WinDataSchema.safeParse({
      contractValue: -100,
      awardDate: '2025-01-15T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('EvaluationScoresSchema', () => {
  it('validates valid scores', () => {
    const result = EvaluationScoresSchema.safeParse({
      technical: 85, price: 90, pastPerformance: 75, management: 80, overall: 82,
    });
    expect(result.success).toBe(true);
  });

  it('allows partial scores', () => {
    expect(EvaluationScoresSchema.safeParse({ technical: 85 }).success).toBe(true);
  });

  it('rejects scores above 100', () => {
    expect(EvaluationScoresSchema.safeParse({ technical: 150 }).success).toBe(false);
  });

  it('rejects negative scores', () => {
    expect(EvaluationScoresSchema.safeParse({ technical: -10 }).success).toBe(false);
  });
});

describe('LossDataSchema', () => {
  it('validates valid loss data', () => {
    const result = LossDataSchema.safeParse({
      lossDate: '2025-01-20T00:00:00Z',
      lossReason: 'PRICE_TOO_HIGH',
      lossReasonDetails: 'Our bid was 15% higher than the winning bid',
      winningContractor: 'Competitor Inc',
      winningBidAmount: 1200000,
      ourBidAmount: 1380000,
      evaluationScores: { technical: 90, price: 70 },
    });
    expect(result.success).toBe(true);
  });

  it('requires lossDate and lossReason', () => {
    const result = LossDataSchema.safeParse({
      lossDate: '2025-01-20T00:00:00Z',
      lossReason: 'UNKNOWN',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing lossReason', () => {
    const result = LossDataSchema.safeParse({ lossDate: '2025-01-20T00:00:00Z' });
    expect(result.success).toBe(false);
  });
});

describe('HistoricalRecordSchema', () => {
  it('validates valid historical record', () => {
    const result = HistoricalRecordSchema.safeParse({
      projectName: 'TSA Document Management',
      solicitationNumber: '70T02024Q00000123',
      agency: 'TSA',
      status: 'WON',
      statusDate: '2024-06-15T00:00:00Z',
      contractValue: 500000,
    });
    expect(result.success).toBe(true);
  });

  it('requires projectName', () => {
    const result = HistoricalRecordSchema.safeParse({
      status: 'LOST',
      statusDate: '2024-06-15T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('requires valid status', () => {
    const result = HistoricalRecordSchema.safeParse({
      projectName: 'Test Project',
      status: 'PENDING',
      statusDate: '2024-06-15T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });
});

describe('ImportHistoricalRequestSchema', () => {
  it('validates valid import request', () => {
    const result = ImportHistoricalRequestSchema.safeParse({
      orgId: 'org-123',
      records: [
        { projectName: 'Project 1', status: 'WON', statusDate: '2024-01-15T00:00:00Z', contractValue: 100000 },
        { projectName: 'Project 2', status: 'LOST', statusDate: '2024-02-20T00:00:00Z', lossReason: 'PRICE_TOO_HIGH' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty records array', () => {
    const result = ImportHistoricalRequestSchema.safeParse({ orgId: 'org-123', records: [] });
    expect(result.success).toBe(false);
  });
});

describe('LOSS_REASON_LABELS', () => {
  it('has labels for all loss reason categories', () => {
    const allReasons: LossReasonCategory[] = [
      'PRICE_TOO_HIGH', 'PRICE_TOO_LOW', 'TECHNICAL_SCORE', 'PAST_PERFORMANCE',
      'INCUMBENT_ADVANTAGE', 'MISSING_CERTIFICATION', 'LATE_SUBMISSION', 'NON_COMPLIANT',
      'WITHDRAWN', 'NO_BID_DECISION', 'UNKNOWN', 'OTHER',
    ];

    allReasons.forEach((reason) => {
      expect(LOSS_REASON_LABELS[reason]).toBeDefined();
      expect(typeof LOSS_REASON_LABELS[reason]).toBe('string');
      expect(LOSS_REASON_LABELS[reason].length).toBeGreaterThan(0);
    });
  });
});
