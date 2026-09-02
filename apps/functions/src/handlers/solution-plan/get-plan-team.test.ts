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

const mockGetDerivedPlanTeam = jest.fn();
jest.mock('@/helpers/plan-team', () => ({
  getDerivedPlanTeam: (...a: unknown[]) => mockGetDerivedPlanTeam(...a),
}));

import { getPlanTeam } from './get-plan-team';

const query = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };
const event = { queryStringParameters: query } as never;

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;
const bodyOf = (res: unknown): Record<string, unknown> =>
  JSON.parse((res as { body: string }).body);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('get-plan-team handler', () => {
  it('returns 400 when query params are missing', async () => {
    const res = await getPlanTeam({ queryStringParameters: { orgId: 'org-1' } } as never);
    expect(statusOf(res)).toBe(400);
    expect(mockGetDerivedPlanTeam).not.toHaveBeenCalled();
  });

  it('returns 404 when the plan does not exist', async () => {
    mockGetDerivedPlanTeam.mockResolvedValue({ planExists: false, team: null });
    const res = await getPlanTeam(event);
    expect(statusOf(res)).toBe(404);
  });

  it('returns team null when the plan has no team yet', async () => {
    mockGetDerivedPlanTeam.mockResolvedValue({ planExists: true, team: null });
    const res = await getPlanTeam(event);
    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res)).toEqual({ ok: true, team: null });
  });

  it('returns the derived team (removedEmployee computed on read)', async () => {
    const team = {
      members: [
        { nameSnapshot: 'Gone Person', role: 'PM', removedEmployee: true, source: 'AI_RECOMMENDED' },
      ],
      userModified: false,
      generatedAt: '2026-08-19T10:00:00.000Z',
    };
    mockGetDerivedPlanTeam.mockResolvedValue({ planExists: true, team });

    const res = await getPlanTeam(event);

    expect(statusOf(res)).toBe(200);
    expect(mockGetDerivedPlanTeam).toHaveBeenCalledWith(query);
    expect(bodyOf(res)).toEqual({ ok: true, team });
  });
});
