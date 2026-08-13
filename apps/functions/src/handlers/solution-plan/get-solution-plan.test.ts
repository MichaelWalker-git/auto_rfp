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

const mockGetPlan = jest.fn();
jest.mock('@/helpers/solution-plan', () => {
  const actual = jest.requireActual('@/helpers/solution-plan');
  return {
    getSolutionPlanByOpportunity: (...a: unknown[]) => mockGetPlan(...a),
    toSolutionPlanItem: actual.toSolutionPlanItem,
  };
});

import { getSolutionPlan } from './get-solution-plan';
import { PK_NAME, SK_NAME } from '@/constants/common';

const query = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };
const event = { queryStringParameters: query } as never;

const dbPlan = {
  [PK_NAME]: 'SOLUTION_PLAN',
  [SK_NAME]: 'org-1#proj-1#opp-1',
  id: 'plan-1',
  ...query,
  status: 'READY',
  isStale: false,
  runId: 'run-1',
  version: 3,
  isUserEdited: false,
};

beforeEach(() => {
  jest.clearAllMocks();
});

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;
const bodyOf = (res: unknown): Record<string, unknown> =>
  JSON.parse((res as { body: string }).body);

describe('get-solution-plan handler', () => {
  it('returns 400 when query params are missing', async () => {
    const res = await getSolutionPlan({ queryStringParameters: { orgId: 'org-1' } } as never);
    expect(statusOf(res)).toBe(400);
    expect(mockGetPlan).not.toHaveBeenCalled();
  });

  it('returns 404 when no plan exists', async () => {
    mockGetPlan.mockResolvedValue(null);
    const res = await getSolutionPlan(event);
    expect(statusOf(res)).toBe(404);
  });

  it('returns the plan with the single-table keys stripped', async () => {
    mockGetPlan.mockResolvedValue(dbPlan);

    const res = await getSolutionPlan(event);

    expect(statusOf(res)).toBe(200);
    expect(mockGetPlan).toHaveBeenCalledWith(query);
    const { plan } = bodyOf(res) as { plan: Record<string, unknown> };
    expect(plan).toMatchObject({ id: 'plan-1', status: 'READY', version: 3 });
    expect(plan).not.toHaveProperty(PK_NAME);
    expect(plan).not.toHaveProperty(SK_NAME);
  });
});
