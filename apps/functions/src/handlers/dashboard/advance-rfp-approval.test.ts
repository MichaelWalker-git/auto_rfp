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

const mockWriteBack = jest.fn();
jest.mock('@/helpers/rfp-linear-writeback', () => ({
  writeBackApprovalToLinear: (...args: unknown[]) => mockWriteBack(...args),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './advance-rfp-approval';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const makeEvent = (body: Record<string, unknown>, userId = 'user-1'): AuthedEvent =>
  ({
    body: JSON.stringify(body),
    queryStringParameters: {},
    headers: {},
    auth: { userId, orgId: (body.orgId as string) ?? undefined },
    rbac: { role: 'EDITOR', permissions: ['opportunity:edit'] },
    requestContext: { http: { sourceIp: '1.2.3.4', userAgent: 'jest' } },
  }) as unknown as AuthedEvent;

const base = { orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1' };

describe('advance-rfp-approval', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTransition.mockResolvedValue({ oppId: 'linear-hor-1', id: 'linear-hor-1', noticeId: 'HOR-1', approvalStatus: 'PRE_SUB_APPROVAL' });
    mockWriteBack.mockResolvedValue({ updated: true });
  });

  it('returns 400 for an invalid payload', async () => {
    const response = await baseHandler(makeEvent({ ...base, to: 'I_APPROVED' }));
    expect(response).toMatchObject({ statusCode: 400 });
    expect(mockTransition).not.toHaveBeenCalled();
  });

  it('advances to PRE_SUB_APPROVAL with gate STAGE', async () => {
    const response = await baseHandler(makeEvent({ ...base, to: 'PRE_SUB_APPROVAL' }));
    expect(mockTransition).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        to: 'PRE_SUB_APPROVAL',
        gate: 'STAGE',
        changedBy: 'user-1',
      }),
    );
    expect(response).toMatchObject({ statusCode: 200 });
  });

  it('advances to SUBMITTED', async () => {
    mockTransition.mockResolvedValueOnce({ oppId: 'opp-1', approvalStatus: 'SUBMITTED' });
    const response = await baseHandler(makeEvent({ ...base, to: 'SUBMITTED' }));
    expect(mockTransition).toHaveBeenCalledWith(expect.objectContaining({ to: 'SUBMITTED', gate: 'STAGE' }));
    expect(response).toMatchObject({ statusCode: 200 });
  });

  it('writes the Pre-Sub advance back to Linear', async () => {
    await baseHandler(makeEvent({ ...base, to: 'PRE_SUB_APPROVAL' }));
    expect(mockWriteBack).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'PRE_SUB_APPROVAL', item: expect.objectContaining({ noticeId: 'HOR-1' }) }),
    );
  });

  it('returns 409 when the transition is illegal', async () => {
    mockTransition.mockRejectedValueOnce(new InvalidApprovalTransitionError('INITIAL_APPROVAL', 'PRE_SUB_APPROVAL'));
    const response = await baseHandler(makeEvent({ ...base, to: 'PRE_SUB_APPROVAL' }));
    expect(response).toMatchObject({ statusCode: 409 });
  });

  it('returns 404 when the opportunity is not found', async () => {
    mockTransition.mockRejectedValueOnce(new Error('Opportunity not found: orgId=org-1'));
    const response = await baseHandler(makeEvent({ ...base, to: 'SUBMITTED' }));
    expect(response).toMatchObject({ statusCode: 404 });
  });
});
