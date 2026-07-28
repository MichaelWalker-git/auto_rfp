import { describe, it, expect } from 'vitest';
import {
  RfpPipelineItemSchema,
  GetRfpPipelineResponseSchema,
  RfpApprovalDecisionSchema,
  RfpApprovalAdvanceSchema,
} from './rfp-tracking';
import {
  OpportunityApprovalStatusSchema,
  OpportunityApprovalTransitionSchema,
  OPPORTUNITY_APPROVAL_LABELS,
  OPPORTUNITY_APPROVAL_COLORS,
  APPROVAL_ORDER,
} from './opportunity';

describe('OpportunityApprovalStatusSchema', () => {
  it('accepts each of the six approval values', () => {
    for (const value of [
      'INITIAL_APPROVAL',
      'I_APPROVED',
      'PRE_SUB_APPROVAL',
      'II_APPROVED',
      'SUBMITTED',
      'NOT_APPROVED',
    ]) {
      expect(OpportunityApprovalStatusSchema.safeParse(value).success).toBe(true);
    }
  });

  it('rejects an unknown approval value', () => {
    expect(OpportunityApprovalStatusSchema.safeParse('IN_PROGRESS').success).toBe(false);
  });
});

describe('approval labels / colors / order', () => {
  it('APPROVAL_ORDER lists all six values in board order', () => {
    expect(APPROVAL_ORDER).toEqual([
      'INITIAL_APPROVAL',
      'I_APPROVED',
      'PRE_SUB_APPROVAL',
      'II_APPROVED',
      'SUBMITTED',
      'NOT_APPROVED',
    ]);
  });

  it('every value has a label and a color', () => {
    for (const value of APPROVAL_ORDER) {
      expect(OPPORTUNITY_APPROVAL_LABELS[value]).toBeTruthy();
      expect(OPPORTUNITY_APPROVAL_COLORS[value]).toBeTruthy();
    }
  });

  it('uses the exact Linear label text', () => {
    expect(OPPORTUNITY_APPROVAL_LABELS.INITIAL_APPROVAL).toBe('Initial Approval');
    expect(OPPORTUNITY_APPROVAL_LABELS.I_APPROVED).toBe('I Approved');
    expect(OPPORTUNITY_APPROVAL_LABELS.PRE_SUB_APPROVAL).toBe('Pre Sub Approval');
    expect(OPPORTUNITY_APPROVAL_LABELS.II_APPROVED).toBe('II Approved');
    expect(OPPORTUNITY_APPROVAL_LABELS.SUBMITTED).toBe('Submitted');
    expect(OPPORTUNITY_APPROVAL_LABELS.NOT_APPROVED).toBe('Not Approved');
  });
});

describe('OpportunityApprovalTransitionSchema', () => {
  it('accepts a well-formed transition', () => {
    const { success } = OpportunityApprovalTransitionSchema.safeParse({
      from: 'INITIAL_APPROVAL',
      to: 'I_APPROVED',
      changedAt: '2026-07-01T10:00:00.000Z',
      changedBy: 'user-1',
      gate: 'INITIAL',
    });
    expect(success).toBe(true);
  });

  it('accepts a null from (first transition)', () => {
    const { success } = OpportunityApprovalTransitionSchema.safeParse({
      from: null,
      to: 'INITIAL_APPROVAL',
      changedAt: '2026-07-01T10:00:00.000Z',
      changedBy: 'system',
      gate: 'STAGE',
    });
    expect(success).toBe(true);
  });

  it('rejects an unknown gate', () => {
    const { success } = OpportunityApprovalTransitionSchema.safeParse({
      from: 'INITIAL_APPROVAL',
      to: 'I_APPROVED',
      changedAt: '2026-07-01T10:00:00.000Z',
      changedBy: 'user-1',
      gate: 'GATE_ONE',
    });
    expect(success).toBe(false);
  });
});

describe('RfpPipelineItemSchema', () => {
  const validItem = {
    id: 'opp-1',
    source: 'MANUAL_UPLOAD' as const,
    title: 'City of Testville RFP',
    status: 'QUALIFYING' as const,
  };

  it('accepts a minimal opportunity list item', () => {
    const { success } = RfpPipelineItemSchema.safeParse(validItem);
    expect(success).toBe(true);
  });

  it('accepts approvalStatus and approvalHistory', () => {
    const { success, data } = RfpPipelineItemSchema.safeParse({
      ...validItem,
      approvalStatus: 'I_APPROVED',
      approvalHistory: [
        {
          from: 'INITIAL_APPROVAL',
          to: 'I_APPROVED',
          changedAt: '2026-07-01T10:00:00.000Z',
          changedBy: 'user-1',
          gate: 'INITIAL',
        },
      ],
    });
    expect(success).toBe(true);
    expect(data?.approvalHistory).toHaveLength(1);
  });

  it('accepts statusHistory and dollar value', () => {
    const { success, data } = RfpPipelineItemSchema.safeParse({
      ...validItem,
      baseAndAllOptionsValue: 250000,
      statusHistory: [
        {
          from: 'IDENTIFIED',
          to: 'QUALIFYING',
          changedAt: '2026-07-01T10:00:00.000Z',
          changedBy: 'user-1',
          source: 'MANUAL',
        },
      ],
    });
    expect(success).toBe(true);
    expect(data?.statusHistory).toHaveLength(1);
  });

  it('accepts null dollar value', () => {
    const { success } = RfpPipelineItemSchema.safeParse({
      ...validItem,
      baseAndAllOptionsValue: null,
    });
    expect(success).toBe(true);
  });

  it('rejects an invalid status', () => {
    const { success } = RfpPipelineItemSchema.safeParse({ ...validItem, status: 'BOGUS' });
    expect(success).toBe(false);
  });
});

describe('GetRfpPipelineResponseSchema', () => {
  it('wraps an items array', () => {
    const { success } = GetRfpPipelineResponseSchema.safeParse({
      items: [{ id: 'opp-1', source: 'SAM_GOV', title: 'X' }],
    });
    expect(success).toBe(true);
  });
});

describe('RfpApprovalDecisionSchema', () => {
  const base = { orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1' };

  it('accepts each gate + decision combo', () => {
    expect(RfpApprovalDecisionSchema.safeParse({ ...base, gate: 'INITIAL', decision: 'APPROVE' }).success).toBe(true);
    expect(RfpApprovalDecisionSchema.safeParse({ ...base, gate: 'INITIAL', decision: 'REJECT', reason: 'over budget' }).success).toBe(true);
    expect(RfpApprovalDecisionSchema.safeParse({ ...base, gate: 'FINAL', decision: 'APPROVE' }).success).toBe(true);
    // FINAL + REJECT is schema-valid; the no-reject-at-gate-2 rule is enforced in the handler.
    expect(RfpApprovalDecisionSchema.safeParse({ ...base, gate: 'FINAL', decision: 'REJECT' }).success).toBe(true);
  });

  it('rejects an unknown gate', () => {
    expect(RfpApprovalDecisionSchema.safeParse({ ...base, gate: 'STAGE', decision: 'APPROVE' }).success).toBe(false);
  });

  it('rejects an unknown decision', () => {
    expect(RfpApprovalDecisionSchema.safeParse({ ...base, gate: 'INITIAL', decision: 'MAYBE' }).success).toBe(false);
  });

  it('requires gate, decision, and identifiers', () => {
    expect(RfpApprovalDecisionSchema.safeParse({ decision: 'APPROVE' }).success).toBe(false);
    expect(RfpApprovalDecisionSchema.safeParse({ ...base, decision: 'APPROVE' }).success).toBe(false);
  });
});

describe('RfpApprovalAdvanceSchema', () => {
  const base = { orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1' };

  it('accepts the two non-gate stage moves', () => {
    expect(RfpApprovalAdvanceSchema.safeParse({ ...base, to: 'PRE_SUB_APPROVAL' }).success).toBe(true);
    expect(RfpApprovalAdvanceSchema.safeParse({ ...base, to: 'SUBMITTED' }).success).toBe(true);
  });

  it('rejects a gate-only target', () => {
    expect(RfpApprovalAdvanceSchema.safeParse({ ...base, to: 'I_APPROVED' }).success).toBe(false);
    expect(RfpApprovalAdvanceSchema.safeParse({ ...base, to: 'NOT_APPROVED' }).success).toBe(false);
  });
});
