import { describe, it, expect } from 'vitest';
import {
  AceStageSchema,
  ACE_STAGE_ORDER,
  AceStageTransitionSchema,
  UpdateAceStageSchema,
  ApnRegistrationStatusSchema,
  AwsServiceSchema,
  ApnRegistrationItemSchema,
  CreateApnRegistrationSchema,
  RetryApnRegistrationSchema,
  ApnRegistrationResponseSchema,
  RetryApnRegistrationResponseSchema,
  ApnRegistrationsListResponseSchema,
} from './apn';

const validRegistrationItem = {
  registrationId: '550e8400-e29b-41d4-a716-446655440000',
  orgId: 'org-123',
  projectId: 'proj-456',
  oppId: 'opp-789',
  status: 'PENDING' as const,
  customerName: 'Acme Corp',
  opportunityValue: 500000,
  awsServices: ['EC2', 'S3'] as const,
  expectedCloseDate: '2025-06-30T00:00:00Z',
  proposalStatus: 'SUBMITTED' as const,
  retryCount: 0,
  registeredBy: 'user-123',
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

describe('AceStageSchema', () => {
  it('accepts exactly the 7 Partner Central stage strings', () => {
    const stages = [
      'Prospect',
      'Qualified',
      'Technical Validation',
      'Business Validation',
      'Committed',
      'Launched',
      'Closed Lost',
    ];
    stages.forEach((stage) => {
      expect(AceStageSchema.safeParse(stage).success).toBe(true);
    });
  });

  it('rejects non-Partner-Central casings and unknown values', () => {
    expect(AceStageSchema.safeParse('PROSPECT').success).toBe(false);
    expect(AceStageSchema.safeParse('prospect').success).toBe(false);
    expect(AceStageSchema.safeParse('Closed Won').success).toBe(false);
    expect(AceStageSchema.safeParse('').success).toBe(false);
  });

  it('ACE_STAGE_ORDER contains all 7 stages in lifecycle order', () => {
    expect(ACE_STAGE_ORDER).toEqual([
      'Prospect',
      'Qualified',
      'Technical Validation',
      'Business Validation',
      'Committed',
      'Launched',
      'Closed Lost',
    ]);
    ACE_STAGE_ORDER.forEach((stage) => {
      expect(AceStageSchema.safeParse(stage).success).toBe(true);
    });
  });
});

describe('AceStageTransitionSchema', () => {
  const validTransition = {
    from: 'Prospect',
    to: 'Qualified',
    changedAt: '2026-08-05T12:00:00Z',
    changedBy: 'user-1',
    source: 'MANUAL',
  };

  it('accepts a valid transition', () => {
    expect(AceStageTransitionSchema.safeParse(validTransition).success).toBe(true);
  });

  it('accepts from=null for the first transition', () => {
    expect(
      AceStageTransitionSchema.safeParse({ ...validTransition, from: null, source: 'GATE_APPROVAL' }).success,
    ).toBe(true);
  });

  it('rejects an invalid source', () => {
    expect(
      AceStageTransitionSchema.safeParse({ ...validTransition, source: 'SYSTEM' }).success,
    ).toBe(false);
  });

  it('rejects a non-datetime changedAt', () => {
    expect(
      AceStageTransitionSchema.safeParse({ ...validTransition, changedAt: 'yesterday' }).success,
    ).toBe(false);
  });
});

describe('UpdateAceStageSchema', () => {
  const valid = { orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', aceStage: 'Committed' };

  it('accepts a valid payload', () => {
    expect(UpdateAceStageSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects missing identifiers', () => {
    expect(UpdateAceStageSchema.safeParse({ ...valid, oppId: '' }).success).toBe(false);
    const { orgId: _orgId, ...withoutOrg } = valid;
    expect(UpdateAceStageSchema.safeParse(withoutOrg).success).toBe(false);
  });

  it('rejects an invalid stage', () => {
    expect(UpdateAceStageSchema.safeParse({ ...valid, aceStage: 'COMMITTED' }).success).toBe(false);
  });
});

describe('ApnRegistrationStatusSchema', () => {
  it('accepts all valid statuses', () => {
    const validStatuses = ['PENDING', 'REGISTERED', 'FAILED', 'RETRYING'];
    validStatuses.forEach((status) => {
      expect(ApnRegistrationStatusSchema.safeParse(status).success).toBe(true);
    });
  });

  it('rejects invalid status', () => {
    expect(ApnRegistrationStatusSchema.safeParse('UNKNOWN').success).toBe(false);
    expect(ApnRegistrationStatusSchema.safeParse('').success).toBe(false);
    expect(ApnRegistrationStatusSchema.safeParse('NOT_CONFIGURED').success).toBe(false);
  });
});

describe('AwsServiceSchema', () => {
  it('accepts valid AWS services', () => {
    expect(AwsServiceSchema.safeParse('EC2').success).toBe(true);
    expect(AwsServiceSchema.safeParse('S3').success).toBe(true);
    expect(AwsServiceSchema.safeParse('Bedrock').success).toBe(true);
    expect(AwsServiceSchema.safeParse('Other').success).toBe(true);
  });

  it('rejects invalid service', () => {
    expect(AwsServiceSchema.safeParse('INVALID_SERVICE').success).toBe(false);
  });
});

describe('ApnRegistrationItemSchema', () => {
  it('validates a complete valid registration item', () => {
    const result = ApnRegistrationItemSchema.safeParse(validRegistrationItem);
    expect(result.success).toBe(true);
  });

  it('validates with optional fields present', () => {
    const withOptionals = {
      ...validRegistrationItem,
      apnOpportunityId: 'apn-opp-123',
      apnOpportunityUrl: 'https://partnercentral.awspartner.com/opp/123',
      description: 'A great opportunity',
      lastError: 'Previous error',
      lastAttemptAt: '2025-01-02T00:00:00Z',
    };
    const result = ApnRegistrationItemSchema.safeParse(withOptionals);
    expect(result.success).toBe(true);
  });

  it('rejects missing required fields', () => {
    const { registrationId: _, ...withoutId } = validRegistrationItem;
    expect(ApnRegistrationItemSchema.safeParse(withoutId).success).toBe(false);
  });

  it('rejects empty awsServices array', () => {
    const invalid = { ...validRegistrationItem, awsServices: [] };
    expect(ApnRegistrationItemSchema.safeParse(invalid).success).toBe(false);
  });

  it('rejects negative opportunityValue', () => {
    const invalid = { ...validRegistrationItem, opportunityValue: -100 };
    expect(ApnRegistrationItemSchema.safeParse(invalid).success).toBe(false);
  });

  it('applies default retryCount of 0', () => {
    const { retryCount: _, ...withoutRetryCount } = validRegistrationItem;
    const result = ApnRegistrationItemSchema.safeParse(withoutRetryCount);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.retryCount).toBe(0);
    }
  });
});

describe('CreateApnRegistrationSchema', () => {
  it('validates valid create DTO', () => {
    const dto = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      customerName: 'Acme Corp',
      opportunityValue: 500000,
      awsServices: ['EC2'],
      expectedCloseDate: '2025-06-30T00:00:00Z',
      proposalStatus: 'SUBMITTED',
      registeredBy: 'user-123',
    };
    expect(CreateApnRegistrationSchema.safeParse(dto).success).toBe(true);
  });

  it('omits server-generated fields', () => {
    const dto = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      customerName: 'Acme Corp',
      opportunityValue: 0,
      awsServices: ['Other'],
      expectedCloseDate: '2025-06-30T00:00:00Z',
      proposalStatus: 'SUBMITTED',
      registeredBy: 'system',
    };
    const result = CreateApnRegistrationSchema.safeParse(dto);
    expect(result.success).toBe(true);
  });
});

describe('RetryApnRegistrationSchema', () => {
  it('validates valid retry DTO', () => {
    const dto = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      registrationId: '550e8400-e29b-41d4-a716-446655440000',
    };
    expect(RetryApnRegistrationSchema.safeParse(dto).success).toBe(true);
  });

  it('requires UUID for registrationId', () => {
    const dto = {
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      registrationId: 'not-a-uuid',
    };
    expect(RetryApnRegistrationSchema.safeParse(dto).success).toBe(false);
  });
});

describe('ApnRegistrationResponseSchema', () => {
  it('validates response with registration', () => {
    const result = ApnRegistrationResponseSchema.safeParse({
      registration: validRegistrationItem,
    });
    expect(result.success).toBe(true);
  });

  it('validates response with null registration', () => {
    const result = ApnRegistrationResponseSchema.safeParse({ registration: null });
    expect(result.success).toBe(true);
  });
});

describe('RetryApnRegistrationResponseSchema', () => {
  it('validates successful retry response', () => {
    const result = RetryApnRegistrationResponseSchema.safeParse({
      ok: true,
      registration: { ...validRegistrationItem, status: 'REGISTERED' },
    });
    expect(result.success).toBe(true);
  });
});

describe('ApnRegistrationsListResponseSchema', () => {
  it('validates response with items', () => {
    const result = ApnRegistrationsListResponseSchema.safeParse({
      items: [validRegistrationItem],
      count: 1,
    });
    expect(result.success).toBe(true);
  });

  it('validates empty list response', () => {
    const result = ApnRegistrationsListResponseSchema.safeParse({
      items: [],
      count: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing count', () => {
    const result = ApnRegistrationsListResponseSchema.safeParse({
      items: [],
    });
    expect(result.success).toBe(false);
  });
});
