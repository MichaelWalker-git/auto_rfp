import { describe, it, expect } from 'vitest';
import {
  DebriefingItemSchema,
  CreateDebriefingRequestSchema,
  UpdateDebriefingRequestSchema,
  GenerateDebriefingLetterRequestSchema,
  generateDebriefingEmailSubject,
  type CreateDebriefingRequest,
} from './debriefing';

describe('DebriefingItemSchema', () => {
  const validDebriefing = {
    debriefId: '550e8400-e29b-41d4-a716-446655440000',
    projectId: 'proj-123',
    orgId: 'org-456',
    opportunityId: 'opp-789',
    solicitationNumber: 'W911NF-21-R-0001',
    contractTitle: 'IT Services Contract',
    awardedOrganization: 'WinnerCo LLC',
    awardNotificationDate: 'January 15, 2025',
    contractingOfficerName: 'Jane Officer',
    contractingOfficerEmail: 'jane@agency.gov',
    requesterName: 'John Smith',
    requesterTitle: 'Contracts Manager',
    requesterEmail: 'john@company.com',
    requesterPhone: '555-123-4567',
    requesterAddress: '123 Business Ave, Arlington VA 22201',
    companyName: 'Acme Corp',
    createdAt: '2025-01-17T10:00:00Z',
    updatedAt: '2025-01-18T15:00:00Z',
    createdBy: 'user-789',
  };

  it('validates a complete debriefing item', () => {
    const result = DebriefingItemSchema.safeParse(validDebriefing);
    expect(result.success).toBe(true);
  });

  it('requires debriefId as UUID', () => {
    const invalid = { ...validDebriefing, debriefId: 'not-a-uuid' };
    const result = DebriefingItemSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('requires projectId', () => {
    const { projectId, ...withoutProjectId } = validDebriefing;
    const result = DebriefingItemSchema.safeParse(withoutProjectId);
    expect(result.success).toBe(false);
  });

  it('requires orgId', () => {
    const { orgId, ...withoutOrgId } = validDebriefing;
    const result = DebriefingItemSchema.safeParse(withoutOrgId);
    expect(result.success).toBe(false);
  });

  it('requires opportunityId', () => {
    const { opportunityId, ...withoutOpportunityId } = validDebriefing;
    const result = DebriefingItemSchema.safeParse(withoutOpportunityId);
    expect(result.success).toBe(false);
  });

  it('requires solicitationNumber', () => {
    const { solicitationNumber, ...without } = validDebriefing;
    const result = DebriefingItemSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('requires companyName', () => {
    const { companyName, ...without } = validDebriefing;
    const result = DebriefingItemSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('validates contractingOfficerEmail as email when present', () => {
    const invalid = { ...validDebriefing, contractingOfficerEmail: 'not-an-email' };
    const result = DebriefingItemSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('validates requesterEmail as email when present', () => {
    const invalid = { ...validDebriefing, requesterEmail: 'not-an-email' };
    const result = DebriefingItemSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('CreateDebriefingRequestSchema', () => {
  const validRequest = {
    projectId: 'proj-123',
    orgId: 'org-456',
    opportunityId: 'opp-789',
    solicitationNumber: 'W911NF-21-R-0001',

    contractTitle: 'IT Services Contract',
    awardedOrganization: 'WinnerCo LLC',
    awardNotificationDate: 'January 15, 2025',
    contractingOfficerName: 'Jane Officer',
    contractingOfficerEmail: 'jane@agency.gov',
    requesterName: 'John Smith',
    requesterTitle: 'Contracts Manager',
    requesterEmail: 'john@company.com',
    requesterPhone: '555-123-4567',
    requesterAddress: '123 Business Ave, Arlington VA 22201',
    companyName: 'Acme Corp',
  };

  it('validates valid create request with all required fields', () => {
    const result = CreateDebriefingRequestSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it('requires projectId', () => {
    const { projectId, ...without } = validRequest;
    const result = CreateDebriefingRequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('requires orgId', () => {
    const { orgId, ...without } = validRequest;
    const result = CreateDebriefingRequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('requires opportunityId', () => {
    const { opportunityId, ...without } = validRequest;
    const result = CreateDebriefingRequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('requires solicitationNumber', () => {
    const { solicitationNumber, ...without } = validRequest;
    const result = CreateDebriefingRequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('requires contractTitle', () => {
    const { contractTitle, ...without } = validRequest;
    const result = CreateDebriefingRequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('accepts request without awardedOrganization', () => {
    const { awardedOrganization, ...without } = validRequest;
    const result = CreateDebriefingRequestSchema.safeParse(without);
    expect(result.success).toBe(true);
  });

  it('accepts request without contractingOfficerName', () => {
    const { contractingOfficerName, ...without } = validRequest;
    const result = CreateDebriefingRequestSchema.safeParse(without);
    expect(result.success).toBe(true);
  });

  it('requires contractingOfficerEmail to be valid email', () => {
    const invalid = { ...validRequest, contractingOfficerEmail: 'not-an-email' };
    const result = CreateDebriefingRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('requires requesterName', () => {
    const { requesterName, ...without } = validRequest;
    const result = CreateDebriefingRequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('requires requesterEmail to be valid email', () => {
    const invalid = { ...validRequest, requesterEmail: 'not-an-email' };
    const result = CreateDebriefingRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('requires companyName', () => {
    const { companyName, ...without } = validRequest;
    const result = CreateDebriefingRequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects empty solicitationNumber', () => {
    const invalid = { ...validRequest, solicitationNumber: '' };
    const result = CreateDebriefingRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('rejects empty projectId', () => {
    const invalid = { ...validRequest, projectId: '' };
    const result = CreateDebriefingRequestSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });
});

describe('UpdateDebriefingRequestSchema', () => {
  const validIdentifiers = {
    orgId: 'org-456',
    projectId: 'proj-123',
    opportunityId: 'opp-789',
    debriefingId: 'debrief-001',
  };

  it('validates with only identifiers (no updatable fields)', () => {
    const result = UpdateDebriefingRequestSchema.safeParse(validIdentifiers);
    expect(result.success).toBe(true);
  });

  it('requires orgId', () => {
    const { orgId, ...without } = validIdentifiers;
    const result = UpdateDebriefingRequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('requires projectId', () => {
    const { projectId, ...without } = validIdentifiers;
    const result = UpdateDebriefingRequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('requires opportunityId', () => {
    const { opportunityId, ...without } = validIdentifiers;
    const result = UpdateDebriefingRequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('requires debriefingId', () => {
    const { debriefingId, ...without } = validIdentifiers;
    const result = UpdateDebriefingRequestSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('rejects empty identifier strings', () => {
    expect(UpdateDebriefingRequestSchema.safeParse({ ...validIdentifiers, orgId: '' }).success).toBe(false);
    expect(UpdateDebriefingRequestSchema.safeParse({ ...validIdentifiers, projectId: '' }).success).toBe(false);
    expect(UpdateDebriefingRequestSchema.safeParse({ ...validIdentifiers, opportunityId: '' }).success).toBe(false);
    expect(UpdateDebriefingRequestSchema.safeParse({ ...validIdentifiers, debriefingId: '' }).success).toBe(false);
  });

  it('accepts optional updatable fields', () => {
    const result = UpdateDebriefingRequestSchema.safeParse({
      ...validIdentifiers,
      contractTitle: 'Updated Title',
      requesterName: 'Jane Updated',
      companyName: 'New Corp',
    });
    expect(result.success).toBe(true);
  });

  it('validates contractingOfficerEmail format when provided', () => {
    const result = UpdateDebriefingRequestSchema.safeParse({
      ...validIdentifiers,
      contractingOfficerEmail: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });

  it('validates requesterEmail format when provided', () => {
    const result = UpdateDebriefingRequestSchema.safeParse({
      ...validIdentifiers,
      requesterEmail: 'not-an-email',
    });
    expect(result.success).toBe(false);
  });
});

describe('GenerateDebriefingLetterRequestSchema', () => {
  it('validates valid request', () => {
    const request = {
      projectId: 'proj-123',
      orgId: 'org-456',
      opportunityId: 'opp-789',
      debriefingId: 'debrief-1',
    };

    const result = GenerateDebriefingLetterRequestSchema.safeParse(request);
    expect(result.success).toBe(true);
  });

  it('requires all four identifiers', () => {
    expect(GenerateDebriefingLetterRequestSchema.safeParse({ projectId: 'proj-123', orgId: 'org-456', opportunityId: 'opp-789' }).success).toBe(false);
    expect(GenerateDebriefingLetterRequestSchema.safeParse({ projectId: 'proj-123', orgId: 'org-456', debriefingId: 'db-1' }).success).toBe(false);
    expect(GenerateDebriefingLetterRequestSchema.safeParse({ projectId: 'proj-123', opportunityId: 'opp-789', debriefingId: 'db-1' }).success).toBe(false);
    expect(GenerateDebriefingLetterRequestSchema.safeParse({ orgId: 'org-456', opportunityId: 'opp-789', debriefingId: 'db-1' }).success).toBe(false);
  });
});

describe('generateDebriefingEmailSubject', () => {
  it('generates correct email subject line', () => {
    const data: CreateDebriefingRequest = {
      projectId: 'proj-123',
      orgId: 'org-456',
      opportunityId: 'opp-789',
      solicitationNumber: 'W911NF-21-R-0001',

      contractTitle: 'IT Services',
      awardedOrganization: 'WinnerCo',
      awardNotificationDate: 'January 15, 2025',
      contractingOfficerName: 'Jane Officer',
      contractingOfficerEmail: 'jane@agency.gov',
      requesterName: 'John Smith',
      requesterTitle: 'Manager',
      requesterEmail: 'john@company.com',
      requesterPhone: '555-123-4567',
      requesterAddress: '456 Oak Ave',
      companyName: 'Acme Corp',
    };

    const subject = generateDebriefingEmailSubject(data);
    expect(subject).toBe('POST-AWARD DEBRIEFING REQUEST — Solicitation No. W911NF-21-R-0001, IT Services');
  });
});
