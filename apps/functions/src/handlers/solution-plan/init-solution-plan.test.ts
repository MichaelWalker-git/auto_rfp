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

const mockInitRun = jest.fn();
jest.mock('@/helpers/solution-plan-init', () => ({
  initSolutionPlanRun: (...a: unknown[]) => mockInitRun(...a),
}));

import { initSolutionPlan } from './init-solution-plan';

const body = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };

const makeEvent = (rawBody: string) => ({ body: rawBody, auth: { userId: 'user-9' } }) as never;

const startedResult = {
  outcome: 'STARTED',
  plan: { id: 'plan-1', ...body, status: 'GRILLING', runId: 'run-new', version: 2 },
  regenerated: true,
  wipedMessages: 3,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockInitRun.mockResolvedValue(startedResult);
});

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;
const bodyOf = (res: unknown): Record<string, unknown> =>
  JSON.parse((res as { body: string }).body);

describe('init-solution-plan handler', () => {
  it('returns 400 when the body is invalid', async () => {
    const res = await initSolutionPlan(makeEvent(JSON.stringify({ orgId: 'org-1' })));
    expect(statusOf(res)).toBe(400);
    expect(mockInitRun).not.toHaveBeenCalled();
  });

  it('returns 400 (not 500) when the body is malformed JSON', async () => {
    const res = await initSolutionPlan(makeEvent('{not json'));
    expect(statusOf(res)).toBe(400);
    expect(mockInitRun).not.toHaveBeenCalled();
  });

  it('passes the key, restart flag, and user to the init helper', async () => {
    await initSolutionPlan(makeEvent(JSON.stringify({ ...body, restart: true })));
    expect(mockInitRun).toHaveBeenCalledWith(body, { restart: true, userId: 'user-9' });
  });

  it('passes the caller display name for the generation-initiator stamp (BR6.1)', async () => {
    const event = {
      body: JSON.stringify(body),
      auth: { userId: 'user-9', claims: { name: 'Alice Example', email: 'alice@example.com' } },
    } as never;

    await initSolutionPlan(event);

    expect(mockInitRun).toHaveBeenCalledWith(body, {
      restart: undefined,
      userId: 'user-9',
      userName: 'Alice Example',
    });
  });

  it('maps NO_PROCESSED_FILES to 400', async () => {
    mockInitRun.mockResolvedValue({ outcome: 'NO_PROCESSED_FILES' });

    const res = await initSolutionPlan(makeEvent(JSON.stringify(body)));

    expect(statusOf(res)).toBe(400);
    expect(bodyOf(res).message).toMatch(/No processed solicitation documents/);
  });

  it('maps RUN_IN_PROGRESS to 409 with the plan status', async () => {
    mockInitRun.mockResolvedValue({ outcome: 'RUN_IN_PROGRESS', solutionPlanStatus: 'GRILLING' });

    const res = await initSolutionPlan(makeEvent(JSON.stringify(body)));

    expect(statusOf(res)).toBe(409);
    expect(bodyOf(res)).toMatchObject({
      code: 'SOLUTION_PLAN_RUN_IN_PROGRESS',
      solutionPlanStatus: 'GRILLING',
    });
  });

  it('maps STARTED to 202 with the run summary', async () => {
    const res = await initSolutionPlan(makeEvent(JSON.stringify(body)));

    expect(statusOf(res)).toBe(202);
    expect(bodyOf(res)).toEqual({
      ok: true,
      solutionPlanId: 'plan-1',
      runId: 'run-new',
      status: 'GRILLING',
      version: 2,
      regenerated: true,
      wipedMessages: 3,
    });
  });

  it('sets the audit context on the happy path', async () => {
    await initSolutionPlan(makeEvent(JSON.stringify(body)));
    expect(mockSetAuditContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: 'AI_GENERATION_STARTED',
        resource: 'pipeline',
        resourceId: 'plan-1',
        orgId: 'org-1',
      }),
    );
  });
});
