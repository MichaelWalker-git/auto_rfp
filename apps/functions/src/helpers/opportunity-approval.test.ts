const mockGetOpportunity = jest.fn();
const mockUpdateOpportunity = jest.fn();

jest.mock('@/helpers/opportunity', () => ({
  getOpportunity: (...args: unknown[]) => mockGetOpportunity(...args),
  updateOpportunity: (...args: unknown[]) => mockUpdateOpportunity(...args),
}));

jest.mock('@/helpers/date', () => ({
  nowIso: () => '2026-07-28T12:00:00.000Z',
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import {
  transitionOpportunityApproval,
  InvalidApprovalTransitionError,
} from './opportunity-approval';
import type { OpportunityApprovalStatus } from '@auto-rfp/core';

const base = { orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1' };

const withCurrent = (approvalStatus: OpportunityApprovalStatus | undefined, approvalHistory: unknown[] = []) => {
  mockGetOpportunity.mockResolvedValue({
    item: { title: 'X', approvalStatus, approvalHistory },
    oppId: 'opp-1',
  });
  mockUpdateOpportunity.mockImplementation(async ({ patch }: { patch: Record<string, unknown> }) => ({
    item: { title: 'X', ...patch },
    oppId: 'opp-1',
  }));
};

describe('transitionOpportunityApproval', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each<[OpportunityApprovalStatus, OpportunityApprovalStatus]>([
    ['INITIAL_APPROVAL', 'I_APPROVED'],
    ['INITIAL_APPROVAL', 'NOT_APPROVED'],
    ['I_APPROVED', 'PRE_SUB_APPROVAL'],
    ['PRE_SUB_APPROVAL', 'II_APPROVED'],
    ['II_APPROVED', 'SUBMITTED'],
  ])('allows %s → %s', async (from, to) => {
    withCurrent(from);
    const item = await transitionOpportunityApproval({
      ...base,
      to,
      changedBy: 'user-1',
      gate: 'STAGE',
    });
    expect(item.approvalStatus).toBe(to);
    expect(mockUpdateOpportunity).toHaveBeenCalledTimes(1);
  });

  it.each<[OpportunityApprovalStatus, OpportunityApprovalStatus]>([
    ['INITIAL_APPROVAL', 'PRE_SUB_APPROVAL'],
    ['INITIAL_APPROVAL', 'II_APPROVED'],
    ['I_APPROVED', 'II_APPROVED'],
    ['I_APPROVED', 'NOT_APPROVED'],
    ['PRE_SUB_APPROVAL', 'SUBMITTED'],
    ['II_APPROVED', 'I_APPROVED'],
    ['SUBMITTED', 'II_APPROVED'],
    ['NOT_APPROVED', 'I_APPROVED'],
  ])('rejects illegal %s → %s', async (from, to) => {
    withCurrent(from);
    await expect(
      transitionOpportunityApproval({ ...base, to, changedBy: 'user-1', gate: 'STAGE' }),
    ).rejects.toBeInstanceOf(InvalidApprovalTransitionError);
    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
  });

  it('defaults a missing approvalStatus to INITIAL_APPROVAL', async () => {
    withCurrent(undefined);
    const item = await transitionOpportunityApproval({
      ...base,
      to: 'I_APPROVED',
      changedBy: 'user-1',
      gate: 'INITIAL',
    });
    expect(item.approvalStatus).toBe('I_APPROVED');
  });

  it('appends the transition to approvalHistory with the from/gate/reason', async () => {
    withCurrent('INITIAL_APPROVAL', [
      { from: null, to: 'INITIAL_APPROVAL', changedAt: '2026-01-01T00:00:00.000Z', changedBy: 'system', gate: 'STAGE' },
    ]);
    await transitionOpportunityApproval({
      ...base,
      to: 'NOT_APPROVED',
      changedBy: 'user-1',
      gate: 'INITIAL',
      reason: 'over budget',
    });
    const patch = mockUpdateOpportunity.mock.calls[0][0].patch;
    expect(patch.approvalHistory).toHaveLength(2);
    expect(patch.approvalHistory[1]).toEqual({
      from: 'INITIAL_APPROVAL',
      to: 'NOT_APPROVED',
      changedAt: '2026-07-28T12:00:00.000Z',
      changedBy: 'user-1',
      gate: 'INITIAL',
      reason: 'over budget',
    });
  });

  it('throws when the opportunity is not found', async () => {
    mockGetOpportunity.mockResolvedValue(undefined);
    await expect(
      transitionOpportunityApproval({ ...base, to: 'I_APPROVED', changedBy: 'user-1', gate: 'INITIAL' }),
    ).rejects.toThrow('Opportunity not found');
    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
  });
});
