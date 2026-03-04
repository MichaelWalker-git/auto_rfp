import { describe, it, expect } from 'vitest';
import {
  ApnRegistrationStatusSchema,
  AwsServiceSchema,
  ApnRegistrationItemSchema,
  CreateApnRegistrationSchema,
  RetryApnRegistrationSchema,
  SaveApnCredentialsSchema,
  GetApnCredentialsResponseSchema,
  ApnRegistrationResponseSchema,
  RetryApnRegistrationResponseSchema,
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

describe('ApnRegistrationStatusSchema', () => {
  it('accepts all valid statuses', () => {
    const validStatuses = ['PENDING', 'REGISTERED', 'FAILED', 'RETRYING', 'NOT_CONFIGURED'];
    validStatuses.forEach((status) => {
      expect(ApnRegistrationStatusSchema.safeParse(status).success).toBe(true);
    });
  });

  it('rejects invalid status', () => {
    expect(ApnRegistrationStatusSchema.safeParse('UNKNOWN').success).toBe(false);
    expect(ApnRegistrationStatusSchema.safeParse('').success).toBe(false);
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
    // registrationId, status, etc. should not be required
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

describe('SaveApnCredentialsSchema', () => {
  it('validates valid credentials', () => {
    const dto = {
      orgId: 'org-123',
      partnerId: 'PARTNER001',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    };
    const result = SaveApnCredentialsSchema.safeParse(dto);
    expect(result.success).toBe(true);
  });

  it('applies default region of us-east-1', () => {
    const dto = {
      orgId: 'org-123',
      partnerId: 'PARTNER001',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    };
    const result = SaveApnCredentialsSchema.safeParse(dto);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.region).toBe('us-east-1');
    }
  });

  it('accepts custom region', () => {
    const dto = {
      orgId: 'org-123',
      partnerId: 'PARTNER001',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'eu-west-1',
    };
    const result = SaveApnCredentialsSchema.safeParse(dto);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.region).toBe('eu-west-1');
    }
  });

  it('rejects short accessKeyId', () => {
    const dto = {
      orgId: 'org-123',
      partnerId: 'PARTNER001',
      accessKeyId: 'SHORT',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    };
    expect(SaveApnCredentialsSchema.safeParse(dto).success).toBe(false);
  });
});

describe('GetApnCredentialsResponseSchema', () => {
  it('validates not-configured response', () => {
    const result = GetApnCredentialsResponseSchema.safeParse({ configured: false });
    expect(result.success).toBe(true);
  });

  it('validates configured response', () => {
    const result = GetApnCredentialsResponseSchema.safeParse({
      configured: true,
      partnerId: 'PARTNER001',
      region: 'us-east-1',
      configuredAt: '2025-01-01T00:00:00Z',
    });
    expect(result.success).toBe(true);
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
