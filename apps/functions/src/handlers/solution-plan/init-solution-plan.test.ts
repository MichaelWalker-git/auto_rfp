jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});
jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h }));
jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({}),
  orgMembershipMiddleware: () => ({}),
  requirePermission: () => ({}),
  httpErrorMiddleware: () => ({}),
}));
const mockSetAuditContext = jest.fn();
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: () => ({}),
  setAuditContext: (...a: unknown[]) => mockSetAuditContext(...a),
}));

const mockGetPlan = jest.fn();
const mockPutPlan = jest.fn();
const mockDeleteMessages = jest.fn();
jest.mock('@/helpers/solution-plan', () => ({
  getSolutionPlanByOpportunity: (...a: unknown[]) => mockGetPlan(...a),
  putSolutionPlan: (...a: unknown[]) => mockPutPlan(...a),
  deleteGrillingMessages: (...a: unknown[]) => mockDeleteMessages(...a),
}));

const mockEnqueue = jest.fn();
jest.mock('@/helpers/solution-plan-queue', () => ({
  enqueueGrillingRound: (...a: unknown[]) => mockEnqueue(...a),
}));

const mockListQuestionFiles = jest.fn();
jest.mock('@/helpers/questionFile', () => ({
  listQuestionFilesByOpportunity: (...a: unknown[]) => mockListQuestionFiles(...a),
  isExtractedQuestionFile: (status: string | undefined) => status === 'PROCESSED',
}));

import { initSolutionPlan } from './init-solution-plan';

const body = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };

const makeEvent = (bodyJson: Record<string, unknown>) =>
  ({
    body: JSON.stringify(bodyJson),
    auth: { userId: 'user-9' },
  }) as never;

const readyPlan = {
  id: 'plan-1',
  ...body,
  status: 'READY',
  isStale: false,
  runId: 'run-old',
  contentKey: 'org-1/proj-1/opp-1/solution-plan/v2/solution-plan.html',
  version: 2,
  isUserEdited: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  createdBy: 'user-1',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockListQuestionFiles.mockResolvedValue({
    items: [{ textFileKey: 'text/key.txt', status: 'PROCESSED' }],
  });
  mockGetPlan.mockResolvedValue(null);
  mockPutPlan.mockImplementation((plan) => Promise.resolve(plan));
  mockDeleteMessages.mockResolvedValue(0);
});

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;
const bodyOf = (res: unknown): Record<string, unknown> =>
  JSON.parse((res as { body: string }).body);

describe('init-solution-plan handler', () => {
  it('returns 400 when the body is invalid', async () => {
    const res = await initSolutionPlan(makeEvent({ orgId: 'org-1' }));
    expect(statusOf(res)).toBe(400);
    expect(mockPutPlan).not.toHaveBeenCalled();
  });

  it('returns 400 when no processed solicitation documents exist', async () => {
    mockListQuestionFiles.mockResolvedValue({
      items: [{ textFileKey: 'text/key.txt', status: 'UPLOADED' }],
    });
    const res = await initSolutionPlan(makeEvent(body));
    expect(statusOf(res)).toBe(400);
    expect(mockPutPlan).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('creates a fresh plan, wipes the transcript, and enqueues round 1', async () => {
    const res = await initSolutionPlan(makeEvent(body));

    expect(statusOf(res)).toBe(202);
    const put = mockPutPlan.mock.calls[0][0];
    expect(put).toMatchObject({
      ...body,
      status: 'GRILLING',
      isStale: false,
      version: 0,
      isUserEdited: false,
      grillingRounds: 0,
      createdBy: 'user-9',
      updatedBy: 'user-9',
    });
    expect(put.id).toEqual(expect.any(String));
    expect(put.runId).toEqual(expect.any(String));

    expect(mockDeleteMessages).toHaveBeenCalledWith(put.id);
    expect(mockEnqueue).toHaveBeenCalledWith({
      ...body,
      solutionPlanId: put.id,
      runId: put.runId,
      round: 1,
      phase: 'GRILL',
    });
    expect(bodyOf(res)).toMatchObject({
      ok: true,
      solutionPlanId: put.id,
      runId: put.runId,
      status: 'GRILLING',
      regenerated: false,
    });
  });

  it('stamps the new runId BEFORE wiping the transcript (ADR-5 ordering)', async () => {
    const order: string[] = [];
    mockPutPlan.mockImplementation((plan) => {
      order.push('put');
      return Promise.resolve(plan);
    });
    mockDeleteMessages.mockImplementation(() => {
      order.push('wipe');
      return Promise.resolve(3);
    });
    mockEnqueue.mockImplementation(() => {
      order.push('enqueue');
      return Promise.resolve();
    });

    await initSolutionPlan(makeEvent(body));
    expect(order).toEqual(['put', 'wipe', 'enqueue']);
  });

  it('regenerates a READY plan in place: same id, monotonic version, fresh runId', async () => {
    mockGetPlan.mockResolvedValue(readyPlan);

    const res = await initSolutionPlan(makeEvent(body));

    expect(statusOf(res)).toBe(202);
    const put = mockPutPlan.mock.calls[0][0];
    expect(put.id).toBe('plan-1'); // one plan id per opportunity, forever (ADR-2)
    expect(put.version).toBe(2); // never reset (ADR-11)
    expect(put.runId).not.toBe('run-old');
    expect(put.status).toBe('GRILLING');
    expect(put.isUserEdited).toBe(false);
    expect(put.contentKey).toBeUndefined(); // run-scoped fields reset
    expect(put.createdAt).toBe('2026-08-01T00:00:00.000Z');
    expect(put.createdBy).toBe('user-1');
    expect(bodyOf(res)).toMatchObject({ regenerated: true });
  });

  it.each(['GRILLING', 'GENERATING_SOT'])(
    'returns 409 when a run is in flight (%s) and restart is not set',
    async (status) => {
      mockGetPlan.mockResolvedValue({ ...readyPlan, status });

      const res = await initSolutionPlan(makeEvent(body));

      expect(statusOf(res)).toBe(409);
      expect(bodyOf(res)).toMatchObject({
        code: 'SOLUTION_PLAN_RUN_IN_PROGRESS',
        solutionPlanStatus: status,
      });
      expect(mockPutPlan).not.toHaveBeenCalled();
      expect(mockEnqueue).not.toHaveBeenCalled();
    },
  );

  it('re-inits an in-flight run when restart: true is passed (ADR-5)', async () => {
    mockGetPlan.mockResolvedValue({ ...readyPlan, status: 'GRILLING' });

    const res = await initSolutionPlan(makeEvent({ ...body, restart: true }));

    expect(statusOf(res)).toBe(202);
    expect(mockPutPlan).toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalled();
  });

  it('re-inits a FAILED plan without a restart flag (retry path)', async () => {
    mockGetPlan.mockResolvedValue({ ...readyPlan, status: 'FAILED', error: 'boom' });

    const res = await initSolutionPlan(makeEvent(body));

    expect(statusOf(res)).toBe(202);
    const put = mockPutPlan.mock.calls[0][0];
    expect(put.error).toBeUndefined();
  });

  it('sets the audit context on the happy path', async () => {
    await initSolutionPlan(makeEvent(body));
    expect(mockSetAuditContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'AI_GENERATION_STARTED',
        resource: 'pipeline',
        orgId: 'org-1',
      }),
    );
  });
});
