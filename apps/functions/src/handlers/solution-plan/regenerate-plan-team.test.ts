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

const mockRegenerateTeam = jest.fn();
jest.mock('@/helpers/plan-team', () => ({
  regenerateTeam: (...a: unknown[]) => mockRegenerateTeam(...a),
}));

// The handler needs the REAL TeamMatchingError class for its instanceof check,
// but the real module pulls the full matching dependency graph — stub the
// class with an equivalent local one.
class FakeTeamMatchingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeamMatchingError';
  }
}
jest.mock('@/helpers/team-matching', () => ({
  TeamMatchingError: FakeTeamMatchingError,
}));

import { regeneratePlanTeam } from './regenerate-plan-team';

const key = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };
const makeEvent = (body: unknown) => ({ body: JSON.stringify(body) }) as never;

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;
const bodyOf = (res: unknown): Record<string, unknown> =>
  JSON.parse((res as { body: string }).body);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('regenerate-plan-team handler', () => {
  it('returns 400 on a missing key triple', async () => {
    const res = await regeneratePlanTeam(makeEvent({ orgId: 'org-1' }));
    expect(statusOf(res)).toBe(400);
    expect(mockRegenerateTeam).not.toHaveBeenCalled();
  });

  it('returns 404 when the plan does not exist', async () => {
    mockRegenerateTeam.mockResolvedValue({ status: 'PLAN_NOT_FOUND' });
    const res = await regeneratePlanTeam(makeEvent(key));
    expect(statusOf(res)).toBe(404);
  });

  it('returns the fresh team on success (userModified reset)', async () => {
    const team = { members: [], userModified: false, generatedAt: '2026-08-19T12:00:00.000Z' };
    mockRegenerateTeam.mockResolvedValue({ status: 'REGENERATED', team });

    const res = await regeneratePlanTeam(makeEvent(key));

    expect(statusOf(res)).toBe(200);
    expect(mockRegenerateTeam).toHaveBeenCalledWith(key);
    expect(bodyOf(res)).toEqual({ ok: true, team });
  });

  it('returns the empty-pool prerequisite as 200, not an error (BR4.1)', async () => {
    mockRegenerateTeam.mockResolvedValue({ status: 'EMPTY_POOL' });

    const res = await regeneratePlanTeam(makeEvent(key));

    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res)).toEqual({ ok: true, team: null, emptyPool: true });
  });

  it('maps a matching failure to 502 with a retriable code (BR4.2)', async () => {
    mockRegenerateTeam.mockRejectedValue(new FakeTeamMatchingError('bedrock down'));

    const res = await regeneratePlanTeam(makeEvent(key));

    expect(statusOf(res)).toBe(502);
    expect(bodyOf(res)).toMatchObject({ code: 'TEAM_MATCHING_FAILED' });
  });

  it('rethrows non-matching errors to the error middleware', async () => {
    mockRegenerateTeam.mockRejectedValue(new Error('dynamo down'));
    await expect(regeneratePlanTeam(makeEvent(key))).rejects.toThrow('dynamo down');
  });
});
