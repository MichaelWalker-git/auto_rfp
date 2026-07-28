jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(),
  setAuditContext: jest.fn(),
}));

const mockGetOpportunity = jest.fn();
jest.mock('@/helpers/opportunity', () => ({
  getOpportunity: (...args: unknown[]) => mockGetOpportunity(...args),
}));

const mockTransition = jest.fn();
class InvalidApprovalTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Illegal approval transition: ${from} → ${to}`);
    this.name = 'InvalidApprovalTransitionError';
  }
}
jest.mock('@/helpers/opportunity-approval', () => ({
  transitionOpportunityApproval: (...args: unknown[]) => mockTransition(...args),
  InvalidApprovalTransitionError,
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './decide-rfp-approval';
import { setAuditContext } from '@/middleware/audit-middleware';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import type { Permission } from '@auto-rfp/core';

const makeEvent = (
  body: Record<string, unknown>,
  permissions: Permission[] = ['opportunity:edit', 'rfp:approve_initial', 'rfp:approve_final'],
  userId = 'user-1',
): AuthedEvent =>
  ({
    body: JSON.stringify(body),
    queryStringParameters: {},
    headers: {},
    auth: { userId, orgId: (body.orgId as string) ?? undefined },
    rbac: { role: 'ADMIN', permissions },
    requestContext: { http: { sourceIp: '1.2.3.4', userAgent: 'jest' } },
  }) as unknown as AuthedEvent;

const base = { orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1' };

describe('decide-rfp-approval', () => {
  beforeEach(() => {
    // mockReset (not just clearAllMocks) so queued mock*Once values don't leak
    // between tests — the 403 gate-2 test short-circuits before getOpportunity.
    mockGetOpportunity.mockReset();
    mockTransition.mockReset();
    (setAuditContext as jest.Mock).mockClear();
    mockGetOpportunity.mockResolvedValue({ item: { approvalStatus: 'INITIAL_APPROVAL', title: 'X' }, oppId: 'opp-1' });
    mockTransition.mockResolvedValue({ oppId: 'opp-1', approvalStatus: 'I_APPROVED' });
  });

  it('returns 400 for an invalid payload', async () => {
    const response = await baseHandler(makeEvent({ orgId: 'org-1', gate: 'INITIAL', decision: 'MAYBE' }));
    expect(response).toMatchObject({ statusCode: 400 });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('INITIAL + APPROVE transitions to I_APPROVED', async () => {
    const response = await baseHandler(makeEvent({ ...base, gate: 'INITIAL', decision: 'APPROVE' }));
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        to: 'I_APPROVED',
        gate: 'INITIAL',
        changedBy: 'user-1',
      }),
    );
    expect(response).toMatchObject({ statusCode: 200 });
  });

  it('logs an OPPORTUNITY_APPROVED audit event on APPROVE', async () => {
    await baseHandler(makeEvent({ ...base, gate: 'INITIAL', decision: 'APPROVE' }));
    expect(setAuditContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'OPPORTUNITY_APPROVED',
        resource: 'opportunity',
        resourceId: 'opp-1',
        orgId: 'org-1',
        changes: { before: { approvalStatus: 'INITIAL_APPROVAL' }, after: { approvalStatus: 'I_APPROVED' } },
      }),
    );
  });

  it('INITIAL + REJECT transitions to NOT_APPROVED', async () => {
    mockTransition.mockResolvedValueOnce({ oppId: 'opp-1', approvalStatus: 'NOT_APPROVED' });
    const response = await baseHandler(makeEvent({ ...base, gate: 'INITIAL', decision: 'REJECT', reason: 'over budget' }));
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'NOT_APPROVED', gate: 'INITIAL', reason: 'over budget' }),
    );
    expect(response).toMatchObject({ statusCode: 200 });
  });

  it('logs an OPPORTUNITY_REJECTED audit event on REJECT', async () => {
    mockTransition.mockResolvedValueOnce({ oppId: 'opp-1', approvalStatus: 'NOT_APPROVED' });
    await baseHandler(makeEvent({ ...base, gate: 'INITIAL', decision: 'REJECT', reason: 'over budget' }));
    expect(setAuditContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'OPPORTUNITY_REJECTED',
        changes: { before: { approvalStatus: 'INITIAL_APPROVAL' }, after: { approvalStatus: 'NOT_APPROVED' } },
      }),
    );
  });

  it('FINAL + APPROVE transitions to II_APPROVED', async () => {
    mockGetOpportunity.mockResolvedValueOnce({ item: { approvalStatus: 'PRE_SUB_APPROVAL' }, oppId: 'opp-1' });
    mockTransition.mockResolvedValueOnce({ oppId: 'opp-1', approvalStatus: 'II_APPROVED' });
    const response = await baseHandler(makeEvent({ ...base, gate: 'FINAL', decision: 'APPROVE' }));
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'II_APPROVED', gate: 'FINAL' }),
    );
    expect(response).toMatchObject({ statusCode: 200 });
  });

  it('FINAL + REJECT returns 400', async () => {
    const response = await baseHandler(makeEvent({ ...base, gate: 'FINAL', decision: 'REJECT' }));
    expect(response).toMatchObject({ statusCode: 400 });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller lacks rfp:approve_initial for gate 1', async () => {
    const response = await baseHandler(
      makeEvent({ ...base, gate: 'INITIAL', decision: 'APPROVE' }, ['opportunity:edit', 'rfp:approve_final']),
    );
    expect(response).toMatchObject({ statusCode: 403 });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('returns 403 when the caller lacks rfp:approve_final for gate 2', async () => {
    mockGetOpportunity.mockResolvedValueOnce({ item: { approvalStatus: 'PRE_SUB_APPROVAL' }, oppId: 'opp-1' });
    const response = await baseHandler(
      makeEvent({ ...base, gate: 'FINAL', decision: 'APPROVE' }, ['opportunity:edit', 'rfp:approve_initial']),
    );
    expect(response).toMatchObject({ statusCode: 403 });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('returns 404 when the opportunity does not exist', async () => {
    mockGetOpportunity.mockResolvedValueOnce(undefined);
    const response = await baseHandler(makeEvent({ ...base, gate: 'INITIAL', decision: 'APPROVE' }));
    expect(response).toMatchObject({ statusCode: 404 });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('returns 409 when the transition is illegal', async () => {
    mockTransition.mockRejectedValueOnce(new InvalidApprovalTransitionError('SUBMITTED', 'I_APPROVED'));
    const response = await baseHandler(makeEvent({ ...base, gate: 'INITIAL', decision: 'APPROVE' }));
    expect(response).toMatchObject({ statusCode: 409 });
  });
});
