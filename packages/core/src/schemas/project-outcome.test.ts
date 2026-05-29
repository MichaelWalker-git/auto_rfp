import { describe, it, expect } from 'vitest';
import {
  LossReasonCategorySchema,
  ProjectOutcomeStatusSchema,
  StatusSourceSchema,
  PeriodOfPerformanceSchema,
  WinDataSchema,
  LossDataSchema,
  EvaluationScoresSchema,
  ProjectOutcomeSchema,
  SetProjectOutcomeRequestSchema,
  HistoricalRecordSchema,
  ImportHistoricalRequestSchema,
  LOSS_REASON_LABELS,
  type LossReasonCategory,
  type SetProjectOutcomeRequest,
} from './project-outcome';

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

describe('ProjectOutcomeStatusSchema', () => {
  it('accepts all valid statuses', () => {
    const validStatuses = ['WON', 'LOST', 'NO_BID', 'WITHDRAWN', 'PENDING'];

    validStatuses.forEach((status) => {
      expect(ProjectOutcomeStatusSchema.safeParse(status).success).toBe(true);
    });
  });

  it('rejects invalid statuses', () => {
    expect(ProjectOutcomeStatusSchema.safeParse('INVALID').success).toBe(false);
    expect(ProjectOutcomeStatusSchema.safeParse('won').success).toBe(false);
  });
});

describe('StatusSourceSchema', () => {
  it('accepts MANUAL and SAM_GOV_SYNC', () => {
    expect(StatusSourceSchema.safeParse('MANUAL').success).toBe(true);
    expect(StatusSourceSchema.safeParse('SAM_GOV_SYNC').success).toBe(true);
  });

  it('rejects invalid sources', () => {
    expect(StatusSourceSchema.safeParse('API').success).toBe(false);
  });
});

describe('PeriodOfPerformanceSchema', () => {
  it('validates valid period of performance', () => {
    const validPop = {
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2026-01-01T00:00:00Z',
      optionYears: 2,
    };

    const result = PeriodOfPerformanceSchema.safeParse(validPop);
    expect(result.success).toBe(true);
  });

  it('allows missing optionYears', () => {
    const pop = {
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2026-01-01T00:00:00Z',
    };

    const result = PeriodOfPerformanceSchema.safeParse(pop);
    expect(result.success).toBe(true);
  });

  it('rejects invalid dates', () => {
    const invalidPop = {
      startDate: 'not-a-date',
      endDate: '2026-01-01T00:00:00Z',
    };

    const result = PeriodOfPerformanceSchema.safeParse(invalidPop);
    expect(result.success).toBe(false);
  });

  it('rejects optionYears greater than 10', () => {
    const pop = {
      startDate: '2025-01-01T00:00:00Z',
      endDate: '2026-01-01T00:00:00Z',
      optionYears: 15,
    };

    const result = PeriodOfPerformanceSchema.safeParse(pop);
    expect(result.success).toBe(false);
  });
});

describe('WinDataSchema', () => {
  it('validates valid win data', () => {
    const validWinData = {
      contractNumber: 'GS-35F-0001',
      contractValue: 1500000,
      awardDate: '2025-01-15T00:00:00Z',
      periodOfPerformance: {
        startDate: '2025-02-01T00:00:00Z',
        endDate: '2026-02-01T00:00:00Z',
      },
      competitorsBeaten: ['Acme Corp', 'TechSolutions'],
      keyFactors: 'Strong past performance and competitive pricing',
    };

    const result = WinDataSchema.safeParse(validWinData);
    expect(result.success).toBe(true);
  });

  it('requires contractValue and awardDate', () => {
    const minimalWinData = {
      contractValue: 500000,
      awardDate: '2025-01-15T00:00:00Z',
    };

    const result = WinDataSchema.safeParse(minimalWinData);
    expect(result.success).toBe(true);
  });

  it('rejects negative contract value', () => {
    const invalidWinData = {
      contractValue: -100,
      awardDate: '2025-01-15T00:00:00Z',
    };

    const result = WinDataSchema.safeParse(invalidWinData);
    expect(result.success).toBe(false);
  });
});

describe('EvaluationScoresSchema', () => {
  it('validates valid scores', () => {
    const scores = {
      technical: 85,
      price: 90,
      pastPerformance: 75,
      management: 80,
      overall: 82,
    };

    const result = EvaluationScoresSchema.safeParse(scores);
    expect(result.success).toBe(true);
  });

  it('allows partial scores', () => {
    const partialScores = {
      technical: 85,
    };

    const result = EvaluationScoresSchema.safeParse(partialScores);
    expect(result.success).toBe(true);
  });

  it('rejects scores above 100', () => {
    const invalidScores = {
      technical: 150,
    };

    const result = EvaluationScoresSchema.safeParse(invalidScores);
    expect(result.success).toBe(false);
  });

  it('rejects negative scores', () => {
    const invalidScores = {
      technical: -10,
    };

    const result = EvaluationScoresSchema.safeParse(invalidScores);
    expect(result.success).toBe(false);
  });
});

describe('LossDataSchema', () => {
  it('validates valid loss data', () => {
    const validLossData = {
      lossDate: '2025-01-20T00:00:00Z',
      lossReason: 'PRICE_TOO_HIGH',
      lossReasonDetails: 'Our bid was 15% higher than the winning bid',
      winningContractor: 'Competitor Inc',
      winningBidAmount: 1200000,
      ourBidAmount: 1380000,
      evaluationScores: {
        technical: 90,
        price: 70,
      },
    };

    const result = LossDataSchema.safeParse(validLossData);
    expect(result.success).toBe(true);
  });

  it('requires lossDate and lossReason', () => {
    const minimalLossData = {
      lossDate: '2025-01-20T00:00:00Z',
      lossReason: 'UNKNOWN',
    };

    const result = LossDataSchema.safeParse(minimalLossData);
    expect(result.success).toBe(true);
  });

  it('rejects missing lossReason', () => {
    const invalidData = {
      lossDate: '2025-01-20T00:00:00Z',
    };

    const result = LossDataSchema.safeParse(invalidData);
    expect(result.success).toBe(false);
  });
});

describe('ProjectOutcomeSchema', () => {
  const baseOutcome = {
    projectId: 'proj-123',
    orgId: 'org-456',
    statusDate: '2025-01-15T00:00:00Z',
    statusSetBy: 'user-789',
    statusSource: 'MANUAL',
    createdAt: '2025-01-15T00:00:00Z',
    updatedAt: '2025-01-15T00:00:00Z',
  };

  it('validates WON outcome with win data', () => {
    const wonOutcome = {
      ...baseOutcome,
      status: 'WON',
      winData: {
        contractValue: 1500000,
        awardDate: '2025-01-15T00:00:00Z',
      },
    };

    const result = ProjectOutcomeSchema.safeParse(wonOutcome);
    expect(result.success).toBe(true);
  });

  it('validates LOST outcome with loss data', () => {
    const lostOutcome = {
      ...baseOutcome,
      status: 'LOST',
      lossData: {
        lossDate: '2025-01-20T00:00:00Z',
        lossReason: 'PRICE_TOO_HIGH',
      },
    };

    const result = ProjectOutcomeSchema.safeParse(lostOutcome);
    expect(result.success).toBe(true);
  });

  it('validates PENDING outcome without additional data', () => {
    const pendingOutcome = {
      ...baseOutcome,
      status: 'PENDING',
    };

    const result = ProjectOutcomeSchema.safeParse(pendingOutcome);
    expect(result.success).toBe(true);
  });
});

describe('SetProjectOutcomeRequestSchema', () => {
  it('validates WON request with win data', () => {
    const request: SetProjectOutcomeRequest = {
      projectId: 'proj-123',
      orgId: 'org-456',
      opportunityId: 'opp-789',
      status: 'WON',
      winData: {
        contractValue: 1500000,
        awardDate: '2025-01-15T00:00:00Z',
      },
    };

    const result = SetProjectOutcomeRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it('rejects WON request without win data', () => {
    const request = {
      projectId: 'proj-123',
      orgId: 'org-456',
      opportunityId: 'opp-789',
      status: 'WON',
    };

    const result = SetProjectOutcomeRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('Win data is required');
    }
  });

  it('validates LOST request with loss data', () => {
    const request = {
      projectId: 'proj-123',
      orgId: 'org-456',
      opportunityId: 'opp-789',
      status: 'LOST',
      lossData: {
        lossDate: '2025-01-20T00:00:00Z',
        lossReason: 'TECHNICAL_SCORE',
      },
    };

    const result = SetProjectOutcomeRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it('rejects LOST request without loss data', () => {
    const request = {
      projectId: 'proj-123',
      orgId: 'org-456',
      opportunityId: 'opp-789',
      status: 'LOST',
    };

    const result = SetProjectOutcomeRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('Loss data is required');
    }
  });

  it('validates NO_BID request without additional data', () => {
    const request = {
      projectId: 'proj-123',
      orgId: 'org-456',
      opportunityId: 'opp-789',
      status: 'NO_BID',
    };

    const result = SetProjectOutcomeRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it('rejects winData for non-WON status', () => {
    const request = {
      projectId: 'proj-123',
      orgId: 'org-456',
      opportunityId: 'opp-789',
      status: 'LOST',
      winData: {
        contractValue: 1000000,
        awardDate: '2025-01-15T00:00:00Z',
      },
      lossData: {
        lossDate: '2025-01-20T00:00:00Z',
        lossReason: 'PRICE_TOO_HIGH',
      },
    };

    const result = SetProjectOutcomeRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });

  it('rejects lossData for non-LOST status', () => {
    const request = {
      projectId: 'proj-123',
      orgId: 'org-456',
      opportunityId: 'opp-789',
      status: 'WON',
      winData: {
        contractValue: 1000000,
        awardDate: '2025-01-15T00:00:00Z',
      },
      lossData: {
        lossDate: '2025-01-20T00:00:00Z',
        lossReason: 'PRICE_TOO_HIGH',
      },
    };

    const result = SetProjectOutcomeRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });

  it('requires projectId', () => {
    const request = {
      orgId: 'org-456',
      opportunityId: 'opp-789',
      status: 'PENDING',
    };

    const result = SetProjectOutcomeRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });

  it('requires orgId', () => {
    const request = {
      projectId: 'proj-123',
      opportunityId: 'opp-789',
      status: 'PENDING',
    };

    const result = SetProjectOutcomeRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });
});

describe('HistoricalRecordSchema', () => {
  it('validates valid historical record', () => {
    const record = {
      projectName: 'TSA Document Management',
      solicitationNumber: '70T02024Q00000123',
      agency: 'TSA',
      status: 'WON',
      statusDate: '2024-06-15T00:00:00Z',
      contractValue: 500000,
    };

    const result = HistoricalRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
  });

  it('requires projectName', () => {
    const record = {
      status: 'LOST',
      statusDate: '2024-06-15T00:00:00Z',
    };

    const result = HistoricalRecordSchema.safeParse(record);
    expect(result.success).toBe(false);
  });

  it('requires valid status', () => {
    const record = {
      projectName: 'Test Project',
      status: 'PENDING',
      statusDate: '2024-06-15T00:00:00Z',
    };

    const result = HistoricalRecordSchema.safeParse(record);
    expect(result.success).toBe(false);
  });
});

describe('ImportHistoricalRequestSchema', () => {
  it('validates valid import request', () => {
    const request = {
      orgId: 'org-123',
      records: [
        {
          projectName: 'Project 1',
          status: 'WON',
          statusDate: '2024-01-15T00:00:00Z',
          contractValue: 100000,
        },
        {
          projectName: 'Project 2',
          status: 'LOST',
          statusDate: '2024-02-20T00:00:00Z',
          lossReason: 'PRICE_TOO_HIGH',
        },
      ],
    };

    const result = ImportHistoricalRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it('rejects empty records array', () => {
    const request = {
      orgId: 'org-123',
      records: [],
    };

    const result = ImportHistoricalRequestSchema.safeParse(request);
    expect(result.success).toBe(false);
  });
});

describe('LOSS_REASON_LABELS', () => {
  it('has labels for all loss reason categories', () => {
    const allReasons: LossReasonCategory[] = [
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

    allReasons.forEach((reason) => {
      expect(LOSS_REASON_LABELS[reason]).toBeDefined();
      expect(typeof LOSS_REASON_LABELS[reason]).toBe('string');
      expect(LOSS_REASON_LABELS[reason].length).toBeGreaterThan(0);
    });
  });
});
