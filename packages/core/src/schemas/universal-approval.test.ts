import { describe, it, expect } from 'vitest';
import {
  UniversalApprovalStatusSchema,
  ApprovableEntityTypeSchema,
  UniversalApprovalItemSchema,
  RequestUniversalApprovalSchema,
  SubmitUniversalReviewSchema,
  convertDocumentApprovalToUniversal,
  getEntityDisplayName,
  getEntityIcon,
} from './universal-approval';

describe('UniversalApprovalStatusSchema', () => {
  it('accepts all valid statuses', () => {
    const validStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'REVISION_REQUESTED', 'CANCELLED'];
    validStatuses.forEach((status) => {
      expect(UniversalApprovalStatusSchema.safeParse(status).success).toBe(true);
    });
  });

  it('rejects invalid statuses', () => {
    expect(UniversalApprovalStatusSchema.safeParse('INVALID').success).toBe(false);
    expect(UniversalApprovalStatusSchema.safeParse('').success).toBe(false);
  });
});

describe('ApprovableEntityTypeSchema', () => {
  it('accepts all valid entity types', () => {
    const validTypes = [
      'rfp-document', 'brief', 'opportunity', 'submission',
      'content-library', 'template', 'foia-request', 'debriefing-request'
    ];
    validTypes.forEach((type) => {
      expect(ApprovableEntityTypeSchema.safeParse(type).success).toBe(true);
    });
  });

  it('rejects invalid entity types', () => {
    expect(ApprovableEntityTypeSchema.safeParse('invalid-type').success).toBe(false);
    expect(ApprovableEntityTypeSchema.safeParse('').success).toBe(false);
  });
});

describe('UniversalApprovalItemSchema', () => {
  const validApproval = {
    approvalId: '550e8400-e29b-41d4-a716-446655440000',
    orgId: 'org-123',
    projectId: 'proj-456',
    entityType: 'rfp-document' as const,
    entityId: 'doc-789',
    entitySK: 'org-123#proj-456#opp-123#doc-789',
    entityName: 'Test Document',
    status: 'PENDING' as const,
    requestedBy: 'user-123',
    requestedByName: 'John Doe',
    requestedAt: '2025-01-01T00:00:00Z',
    reviewerId: 'user-456',
    reviewerName: 'Jane Smith',
    reviewerEmail: 'jane@example.com',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
  };

  it('validates a complete approval item', () => {
    const result = UniversalApprovalItemSchema.safeParse(validApproval);
    expect(result.success).toBe(true);
  });

  it('requires approvalId as UUID', () => {
    const invalid = { ...validApproval, approvalId: 'not-a-uuid' };
    const result = UniversalApprovalItemSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('requires entityType', () => {
    const { entityType, ...withoutEntityType } = validApproval;
    const result = UniversalApprovalItemSchema.safeParse(withoutEntityType);
    expect(result.success).toBe(false);
  });

  it('requires entityId', () => {
    const { entityId, ...withoutEntityId } = validApproval;
    const result = UniversalApprovalItemSchema.safeParse(withoutEntityId);
    expect(result.success).toBe(false);
  });

  it('requires entitySK', () => {
    const { entitySK, ...withoutEntitySK } = validApproval;
    const result = UniversalApprovalItemSchema.safeParse(withoutEntitySK);
    expect(result.success).toBe(false);
  });

  it('allows minimal approval with optional fields', () => {
    const minimal = {
      approvalId: '550e8400-e29b-41d4-a716-446655440000',
      orgId: 'org-123',
      entityType: 'brief' as const,
      entityId: 'brief-789',
      entitySK: 'org-123#proj-456#opp-123#brief-789',
      status: 'APPROVED' as const,
      requestedBy: 'user-123',
      requestedAt: '2025-01-01T00:00:00Z',
      reviewerId: 'user-456',
      createdAt: '2025-01-01T00:00:00Z',
      updatedAt: '2025-01-01T00:00:00Z',
    };
    const result = UniversalApprovalItemSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });
});

describe('RequestUniversalApprovalSchema', () => {
  const validRequest = {
    orgId: 'org-123',
    projectId: 'proj-456',
    entityType: 'rfp-document' as const,
    entityId: 'doc-789',
    entitySK: 'org-123#proj-456#opp-123#doc-789',
    entityName: 'Test Document',
    reviewerId: 'user-456',
  };

  it('validates a complete request', () => {
    const result = RequestUniversalApprovalSchema.safeParse(validRequest);
    expect(result.success).toBe(true);
  });

  it('requires orgId', () => {
    const { orgId, ...withoutOrgId } = validRequest;
    const result = RequestUniversalApprovalSchema.safeParse(withoutOrgId);
    expect(result.success).toBe(false);
  });

  it('requires entityType', () => {
    const { entityType, ...withoutEntityType } = validRequest;
    const result = RequestUniversalApprovalSchema.safeParse(withoutEntityType);
    expect(result.success).toBe(false);
  });

  it('requires reviewerId', () => {
    const { reviewerId, ...withoutReviewerId } = validRequest;
    const result = RequestUniversalApprovalSchema.safeParse(withoutReviewerId);
    expect(result.success).toBe(false);
  });

  it('allows optional projectId', () => {
    const { projectId, ...withoutProjectId } = validRequest;
    const result = RequestUniversalApprovalSchema.safeParse(withoutProjectId);
    expect(result.success).toBe(true);
  });
});

describe('SubmitUniversalReviewSchema', () => {
  const baseReview = {
    orgId: 'org-123',
    projectId: 'proj-456',
    entityType: 'rfp-document' as const,
    entityId: 'doc-789',
    approvalId: '550e8400-e29b-41d4-a716-446655440000',
  };

  it('validates approved review', () => {
    const approvedReview = {
      ...baseReview,
      decision: 'APPROVED' as const,
      reviewNote: 'Looks good!',
    };
    const result = SubmitUniversalReviewSchema.safeParse(approvedReview);
    expect(result.success).toBe(true);
  });

  it('validates rejected review with required note', () => {
    const rejectedReview = {
      ...baseReview,
      decision: 'REJECTED' as const,
      reviewNote: 'Needs more work',
    };
    const result = SubmitUniversalReviewSchema.safeParse(rejectedReview);
    expect(result.success).toBe(true);
  });

  it('requires reviewNote for rejected reviews', () => {
    const rejectedWithoutNote = {
      ...baseReview,
      decision: 'REJECTED' as const,
    };
    const result = SubmitUniversalReviewSchema.safeParse(rejectedWithoutNote);
    expect(result.success).toBe(false);
  });

  it('allows empty reviewNote for approved reviews', () => {
    const approvedWithoutNote = {
      ...baseReview,
      decision: 'APPROVED' as const,
    };
    const result = SubmitUniversalReviewSchema.safeParse(approvedWithoutNote);
    expect(result.success).toBe(true);
  });

  it('requires valid UUID for approvalId', () => {
    const invalidApprovalId = {
      ...baseReview,
      approvalId: 'not-a-uuid',
      decision: 'APPROVED' as const,
    };
    const result = SubmitUniversalReviewSchema.safeParse(invalidApprovalId);
    expect(result.success).toBe(false);
  });
});

describe('Helper Functions', () => {
  describe('convertDocumentApprovalToUniversal', () => {
    it('converts document approval to universal format', () => {
      const documentApproval = {
        approvalId: '550e8400-e29b-41d4-a716-446655440000',
        orgId: 'org-123',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
        documentId: 'doc-123',
        documentName: 'Test Document',
        status: 'PENDING',
        requestedBy: 'user-123',
        requestedAt: '2025-01-01T00:00:00Z',
        reviewerId: 'user-456',
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-01T00:00:00Z',
      };

      const universal = convertDocumentApprovalToUniversal(documentApproval);

      expect(universal.entityType).toBe('rfp-document');
      expect(universal.entityId).toBe('doc-123');
      expect(universal.entitySK).toBe('org-123#proj-456#opp-789#doc-123');
      expect(universal.entityName).toBe('Test Document');
      expect(universal.documentId).toBe('doc-123');
      expect(universal.opportunityId).toBe('opp-789');
    });
  });

  describe('getEntityDisplayName', () => {
    it('returns correct display names for all entity types', () => {
      expect(getEntityDisplayName('rfp-document')).toBe('RFP Document');
      expect(getEntityDisplayName('brief')).toBe('Executive Brief');
      expect(getEntityDisplayName('opportunity')).toBe('Opportunity');
      expect(getEntityDisplayName('submission')).toBe('Proposal Submission');
      expect(getEntityDisplayName('content-library')).toBe('Content Library Item');
      expect(getEntityDisplayName('template')).toBe('Template');
      expect(getEntityDisplayName('foia-request')).toBe('FOIA Request');
      expect(getEntityDisplayName('debriefing-request')).toBe('Debriefing Request');
    });
  });

  describe('getEntityIcon', () => {
    it('returns correct icons for all entity types', () => {
      expect(getEntityIcon('rfp-document')).toBe('📄');
      expect(getEntityIcon('brief')).toBe('📋');
      expect(getEntityIcon('opportunity')).toBe('🎯');
      expect(getEntityIcon('submission')).toBe('📤');
      expect(getEntityIcon('content-library')).toBe('📚');
      expect(getEntityIcon('template')).toBe('📝');
      expect(getEntityIcon('foia-request')).toBe('🔍');
      expect(getEntityIcon('debriefing-request')).toBe('📊');
    });
  });
});