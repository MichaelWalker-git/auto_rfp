import { describe, it, expect } from 'vitest';
import {
  ComplianceFindingSchema,
  FindingAnchorSchema,
  ComplianceReviewRunSchema,
  FindingDecisionSchema,
  ComplianceReviewChatResponseSchema,
  UpdateDecisionRequestSchema,
} from './compliance-review';

describe('FindingAnchorSchema', () => {
  it('accepts a heading anchor', () => {
    const { success } = FindingAnchorSchema.safeParse({ kind: 'heading', text: '3.1 Technical Approach' });
    expect(success).toBe(true);
  });

  it('accepts a cell anchor', () => {
    const { success } = FindingAnchorSchema.safeParse({ kind: 'cell', sheet: 'Pricing', row: 4, col: 2 });
    expect(success).toBe(true);
  });

  it('accepts a field anchor', () => {
    const { success } = FindingAnchorSchema.safeParse({ kind: 'field', fieldId: 'field-abc' });
    expect(success).toBe(true);
  });

  it('rejects an unknown kind', () => {
    expect(FindingAnchorSchema.safeParse({ kind: 'paragraph', text: 'x' }).success).toBe(false);
  });

  it('rejects a heading anchor missing text', () => {
    expect(FindingAnchorSchema.safeParse({ kind: 'heading' }).success).toBe(false);
  });
});

describe('ComplianceFindingSchema', () => {
  const valid = {
    findingId: 'f-1',
    fingerprint: 'fp-1',
    targetKind: 'RFP_DOCUMENT',
    documentId: 'doc-1',
    documentTitle: 'Technical Volume',
    anchor: { kind: 'heading', text: 'Section L' },
    snippet: 'The offeror shall...',
    issueType: 'MISSING_REQUIREMENT',
    severity: 'major',
    title: 'Section L not addressed',
    description: 'The technical volume does not address the Section L instruction.',
  };

  it('parses a valid finding and defaults anchorValid to false', () => {
    const { success, data } = ComplianceFindingSchema.safeParse(valid);
    expect(success).toBe(true);
    expect(data?.anchorValid).toBe(false);
  });

  it('allows a finding with no anchor (unlocalized)', () => {
    const { anchor, ...noAnchor } = valid;
    expect(ComplianceFindingSchema.safeParse(noAnchor).success).toBe(true);
  });

  it('allows a FORM_MISSING finding with no documentId', () => {
    const { documentId, anchor, ...missing } = valid;
    const { success } = ComplianceFindingSchema.safeParse({
      ...missing,
      targetKind: 'FORM_MISSING',
      issueType: 'MISSING_FORM',
    });
    expect(success).toBe(true);
  });

  it('rejects an invalid severity', () => {
    expect(ComplianceFindingSchema.safeParse({ ...valid, severity: 'blocker' }).success).toBe(false);
  });
});

describe('ComplianceReviewRunSchema', () => {
  const valid = {
    reviewId: '11111111-1111-1111-1111-111111111111',
    orgId: 'org-1',
    projectId: 'proj-1',
    oppId: 'opp-1',
    status: 'RUNNING',
    trigger: 'FULL',
    startedAt: '2026-07-28T12:00:00.000Z',
  };

  it('parses with defaulted snapshotVersionIds and findings', () => {
    const { success, data } = ComplianceReviewRunSchema.safeParse(valid);
    expect(success).toBe(true);
    expect(data?.snapshotVersionIds).toEqual({});
    expect(data?.findings).toEqual([]);
  });

  it('rejects a non-uuid reviewId', () => {
    expect(ComplianceReviewRunSchema.safeParse({ ...valid, reviewId: 'nope' }).success).toBe(false);
  });

  it('rejects an unknown status', () => {
    expect(ComplianceReviewRunSchema.safeParse({ ...valid, status: 'PENDING' }).success).toBe(false);
  });
});

describe('FindingDecisionSchema', () => {
  it('accepts dismissed and resolved', () => {
    const base = { fingerprint: 'fp-1', decidedAt: '2026-07-28T12:00:00.000Z' };
    expect(FindingDecisionSchema.safeParse({ ...base, state: 'dismissed' }).success).toBe(true);
    expect(FindingDecisionSchema.safeParse({ ...base, state: 'resolved' }).success).toBe(true);
  });

  it('rejects an unknown state', () => {
    expect(
      FindingDecisionSchema.safeParse({ fingerprint: 'fp-1', state: 'ignored', decidedAt: '2026-07-28T12:00:00.000Z' }).success,
    ).toBe(false);
  });
});

describe('UpdateDecisionRequestSchema', () => {
  it('allows a null state to clear a decision', () => {
    expect(UpdateDecisionRequestSchema.safeParse({ fingerprint: 'fp-1', state: null }).success).toBe(true);
  });
});

describe('ComplianceReviewChatResponseSchema', () => {
  it('requires a uuid messageId', () => {
    const { success } = ComplianceReviewChatResponseSchema.safeParse({
      answer: 'ok',
      findings: [],
      messageId: '22222222-2222-2222-2222-222222222222',
    });
    expect(success).toBe(true);
  });
});
