import { describe, it, expect } from 'vitest';
import {
  ProposalSubmissionStatusSchema,
  SubmissionMethodSchema,
  ReadinessCheckItemSchema,
  SubmissionReadinessResponseSchema,
  ProposalSubmissionItemSchema,
  SubmitProposalSchema,
  WithdrawSubmissionSchema,
  SubmitProposalResponseSchema,
  ProposalSubmissionHistoryResponseSchema,
} from './proposal-submission';

const validSubmissionItem = {
  submissionId: '550e8400-e29b-41d4-a716-446655440000',
  orgId: 'org-123',
  projectId: 'proj-456',
  oppId: 'opp-789',
  status: 'SUBMITTED' as const,
  submissionMethod: 'PORTAL' as const,
  submittedAt: '2025-01-01T00:00:00Z',
  submittedBy: 'user-123',
  documentIds: [],
  createdAt: '2025-01-01T00:00:00Z',
  updatedAt: '2025-01-01T00:00:00Z',
};

// ─── ProposalSubmissionStatusSchema ──────────────────────────────────────────

describe('ProposalSubmissionStatusSchema', () => {
  it('accepts all valid statuses', () => {
    expect(ProposalSubmissionStatusSchema.safeParse('SUBMITTED').success).toBe(true);
    expect(ProposalSubmissionStatusSchema.safeParse('WITHDRAWN').success).toBe(true);
  });

  it('rejects invalid status', () => {
    expect(ProposalSubmissionStatusSchema.safeParse('PENDING').success).toBe(false);
    expect(ProposalSubmissionStatusSchema.safeParse('').success).toBe(false);
    expect(ProposalSubmissionStatusSchema.safeParse('UNKNOWN').success).toBe(false);
  });
});

// ─── SubmissionMethodSchema ───────────────────────────────────────────────────

describe('SubmissionMethodSchema', () => {
  it('accepts all valid methods', () => {
    const methods = ['PORTAL', 'EMAIL', 'MANUAL', 'HAND_DELIVERY', 'OTHER'];
    methods.forEach((m) => {
      expect(SubmissionMethodSchema.safeParse(m).success).toBe(true);
    });
  });

  it('rejects invalid method', () => {
    expect(SubmissionMethodSchema.safeParse('FAX').success).toBe(false);
    expect(SubmissionMethodSchema.safeParse('').success).toBe(false);
  });
});

// ─── ReadinessCheckItemSchema ─────────────────────────────────────────────────

describe('ReadinessCheckItemSchema', () => {
  it('validates a minimal check item', () => {
    const result = ReadinessCheckItemSchema.safeParse({
      id: 'opportunity_stage',
      label: 'Opportunity approved for pursuit',
      passed: true,
      blocking: true,
    });
    expect(result.success).toBe(true);
  });

  it('validates a check item with all optional fields', () => {
    const result = ReadinessCheckItemSchema.safeParse({
      id: 'deadline_check',
      label: 'Submission deadline',
      description: 'Submit before the response deadline.',
      passed: false,
      detail: 'Deadline passed 2h ago',
      blocking: false,
    });
    expect(result.success).toBe(true);
  });

  it('applies default blocking = true', () => {
    const result = ReadinessCheckItemSchema.safeParse({
      id: 'test',
      label: 'Test check',
      passed: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blocking).toBe(true);
    }
  });

  it('rejects empty id', () => {
    expect(ReadinessCheckItemSchema.safeParse({ id: '', label: 'Test', passed: true }).success).toBe(false);
  });

  it('rejects empty label', () => {
    expect(ReadinessCheckItemSchema.safeParse({ id: 'test', label: '', passed: true }).success).toBe(false);
  });
});

// ─── SubmissionReadinessResponseSchema ───────────────────────────────────────

describe('SubmissionReadinessResponseSchema', () => {
  it('validates a ready response', () => {
    const result = SubmissionReadinessResponseSchema.safeParse({
      ready: true,
      checks: [],
      blockingFails: 0,
      warningFails: 0,
    });
    expect(result.success).toBe(true);
  });

  it('validates a not-ready response with checks', () => {
    const result = SubmissionReadinessResponseSchema.safeParse({
      ready: false,
      checks: [
        { id: 'opportunity_stage', label: 'Stage check', passed: false, blocking: true },
      ],
      blockingFails: 1,
      warningFails: 0,
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative blockingFails', () => {
    expect(SubmissionReadinessResponseSchema.safeParse({
      ready: false,
      checks: [],
      blockingFails: -1,
      warningFails: 0,
    }).success).toBe(false);
  });
});

// ─── ProposalSubmissionItemSchema ─────────────────────────────────────────────

describe('ProposalSubmissionItemSchema', () => {
  it('validates a minimal submission item', () => {
    const result = ProposalSubmissionItemSchema.safeParse(validSubmissionItem);
    expect(result.success).toBe(true);
  });

  it('validates with all optional fields', () => {
    const result = ProposalSubmissionItemSchema.safeParse({
      ...validSubmissionItem,
      submittedByName: 'John Doe',
      submissionReference: 'SAM-2025-001234',
      submissionNotes: 'Submitted via portal',
      portalUrl: 'https://sam.gov/opp/123',
      deadlineIso: '2025-02-01T00:00:00Z',
      documentIds: ['doc-1', 'doc-2'],
    });
    expect(result.success).toBe(true);
  });

  it('validates a withdrawn submission', () => {
    const result = ProposalSubmissionItemSchema.safeParse({
      ...validSubmissionItem,
      status: 'WITHDRAWN',
      withdrawnAt: '2025-01-15T00:00:00Z',
      withdrawnBy: 'user-123',
      withdrawalReason: 'Solicitation cancelled',
    });
    expect(result.success).toBe(true);
  });

  it('applies default documentIds = []', () => {
    const { documentIds: _, ...withoutDocIds } = validSubmissionItem;
    const result = ProposalSubmissionItemSchema.safeParse(withoutDocIds);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.documentIds).toEqual([]);
    }
  });

  it('rejects invalid UUID for submissionId', () => {
    expect(ProposalSubmissionItemSchema.safeParse({
      ...validSubmissionItem,
      submissionId: 'not-a-uuid',
    }).success).toBe(false);
  });

  it('rejects invalid URL for portalUrl', () => {
    expect(ProposalSubmissionItemSchema.safeParse({
      ...validSubmissionItem,
      portalUrl: 'not-a-url',
    }).success).toBe(false);
  });

  it('rejects submissionNotes exceeding 2000 chars', () => {
    expect(ProposalSubmissionItemSchema.safeParse({
      ...validSubmissionItem,
      submissionNotes: 'x'.repeat(2001),
    }).success).toBe(false);
  });

  it('rejects withdrawalReason exceeding 1000 chars', () => {
    expect(ProposalSubmissionItemSchema.safeParse({
      ...validSubmissionItem,
      withdrawalReason: 'x'.repeat(1001),
    }).success).toBe(false);
  });
});

// ─── SubmitProposalSchema ─────────────────────────────────────────────────────

describe('SubmitProposalSchema', () => {
  it('validates a minimal submit DTO', () => {
    const result = SubmitProposalSchema.safeParse({
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      submissionMethod: 'PORTAL',
    });
    expect(result.success).toBe(true);
  });

  it('validates with all optional fields', () => {
    const result = SubmitProposalSchema.safeParse({
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      submissionMethod: 'EMAIL',
      submissionReference: 'REF-001',
      submissionNotes: 'Sent via email',
      portalUrl: 'https://sam.gov/opp/123',
      documentIds: ['doc-1'],
      forceSubmit: true,
    });
    expect(result.success).toBe(true);
  });

  it('applies default forceSubmit = false', () => {
    const result = SubmitProposalSchema.safeParse({
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      submissionMethod: 'PORTAL',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.forceSubmit).toBe(false);
    }
  });

  it('rejects missing orgId', () => {
    expect(SubmitProposalSchema.safeParse({
      projectId: 'proj-456',
      oppId: 'opp-789',
      submissionMethod: 'PORTAL',
    }).success).toBe(false);
  });

  it('rejects invalid submissionMethod', () => {
    expect(SubmitProposalSchema.safeParse({
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      submissionMethod: 'FAX',
    }).success).toBe(false);
  });

  it('rejects invalid portalUrl', () => {
    expect(SubmitProposalSchema.safeParse({
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      submissionMethod: 'PORTAL',
      portalUrl: 'not-a-url',
    }).success).toBe(false);
  });
});

// ─── WithdrawSubmissionSchema ─────────────────────────────────────────────────

describe('WithdrawSubmissionSchema', () => {
  it('validates a minimal withdraw DTO', () => {
    const result = WithdrawSubmissionSchema.safeParse({
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      submissionId: '550e8400-e29b-41d4-a716-446655440000',
    });
    expect(result.success).toBe(true);
  });

  it('validates with optional withdrawalReason', () => {
    const result = WithdrawSubmissionSchema.safeParse({
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      submissionId: '550e8400-e29b-41d4-a716-446655440000',
      withdrawalReason: 'Solicitation cancelled',
    });
    expect(result.success).toBe(true);
  });

  it('requires UUID for submissionId', () => {
    expect(WithdrawSubmissionSchema.safeParse({
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      submissionId: 'not-a-uuid',
    }).success).toBe(false);
  });

  it('rejects withdrawalReason exceeding 1000 chars', () => {
    expect(WithdrawSubmissionSchema.safeParse({
      orgId: 'org-123',
      projectId: 'proj-456',
      oppId: 'opp-789',
      submissionId: '550e8400-e29b-41d4-a716-446655440000',
      withdrawalReason: 'x'.repeat(1001),
    }).success).toBe(false);
  });
});

// ─── SubmitProposalResponseSchema ─────────────────────────────────────────────

describe('SubmitProposalResponseSchema', () => {
  it('validates a successful response', () => {
    const result = SubmitProposalResponseSchema.safeParse({
      ok: true,
      submission: validSubmissionItem,
    });
    expect(result.success).toBe(true);
  });
});

// ─── ProposalSubmissionHistoryResponseSchema ──────────────────────────────────

describe('ProposalSubmissionHistoryResponseSchema', () => {
  it('validates an empty history response', () => {
    const result = ProposalSubmissionHistoryResponseSchema.safeParse({
      items: [],
      count: 0,
    });
    expect(result.success).toBe(true);
  });

  it('validates a history response with items', () => {
    const result = ProposalSubmissionHistoryResponseSchema.safeParse({
      items: [validSubmissionItem],
      count: 1,
    });
    expect(result.success).toBe(true);
  });
});
