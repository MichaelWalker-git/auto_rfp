import type {
  RfpPipelineItem,
  OpportunityStatus,
  OpportunityApprovalStatus,
} from '@auto-rfp/core';

/**
 * Build an RfpPipelineItem with sensible defaults. Every field is overridable so
 * each test can express only the shape it cares about.
 */
export const makeItem = (overrides: Partial<RfpPipelineItem> = {}): RfpPipelineItem => ({
  id: 'opp-1',
  oppId: 'opp-1',
  orgId: 'org-1',
  projectId: 'proj-1',
  source: 'MANUAL_UPLOAD',
  title: 'Cloud Migration RFP',
  status: 'IDENTIFIED',
  approvalStatus: 'INITIAL_APPROVAL',
  assigneeId: 'user-1',
  assigneeName: 'Jane Doe',
  responseDeadlineIso: undefined,
  baseAndAllOptionsValue: 100_000,
  statusHistory: [],
  approvalHistory: [],
  ...overrides,
});

/** A single approvalHistory transition, defaults filled in. */
export const approvalTransition = (
  to: OpportunityApprovalStatus,
  changedAt: string,
  from: OpportunityApprovalStatus | null = null,
  gate: 'INITIAL' | 'FINAL' | 'STAGE' = 'STAGE',
) => ({
  from,
  to,
  changedAt,
  changedBy: 'user-1',
  gate,
});

/** A single statusHistory transition, defaults filled in. */
export const transition = (
  to: OpportunityStatus,
  changedAt: string,
  from: OpportunityStatus | null = null,
) => ({
  from,
  to,
  changedAt,
  changedBy: 'user-1',
  source: 'MANUAL' as const,
});
