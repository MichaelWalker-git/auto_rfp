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
const mockLoadHtml = jest.fn();
jest.mock('@/helpers/solution-plan', () => ({
  getSolutionPlanByOpportunity: (...a: unknown[]) => mockGetPlan(...a),
  loadSolutionPlanHtml: (...a: unknown[]) => mockLoadHtml(...a),
}));

import { getHtmlContent } from './get-html-content';

const query = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };
const event = { queryStringParameters: query } as never;

const readyPlan = {
  id: 'plan-1',
  ...query,
  status: 'READY',
  isStale: false,
  runId: 'run-1',
  contentKey: 'org-1/proj-1/opp-1/solution-plan/v2/solution-plan.html',
  version: 2,
  isUserEdited: true,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPlan.mockResolvedValue(readyPlan);
  mockLoadHtml.mockResolvedValue('<h1>Plan</h1>');
});

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;
const bodyOf = (res: unknown): Record<string, unknown> =>
  JSON.parse((res as { body: string }).body);

describe('get-html-content handler', () => {
  it('returns 400 when query params are missing', async () => {
    const res = await getHtmlContent({ queryStringParameters: {} } as never);
    expect(statusOf(res)).toBe(400);
  });

  it('returns 404 when no plan exists', async () => {
    mockGetPlan.mockResolvedValue(null);
    const res = await getHtmlContent(event);
    expect(statusOf(res)).toBe(404);
  });

  it.each(['GRILLING', 'GENERATING_SOT'])(
    'returns 202 while the run is in flight (%s, no content yet)',
    async (status) => {
      mockGetPlan.mockResolvedValue({ ...readyPlan, status, contentKey: undefined });
      const res = await getHtmlContent(event);
      expect(statusOf(res)).toBe(202);
      expect(bodyOf(res)).toMatchObject({ solutionPlanStatus: status });
      expect(mockLoadHtml).not.toHaveBeenCalled();
    },
  );

  it('returns 422 with the stored error for a FAILED plan without content', async () => {
    mockGetPlan.mockResolvedValue({
      ...readyPlan,
      status: 'FAILED',
      contentKey: undefined,
      error: 'Synthesis blew up',
    });
    const res = await getHtmlContent(event);
    expect(statusOf(res)).toBe(422);
    expect(bodyOf(res)).toMatchObject({ error: 'Synthesis blew up' });
  });

  it('serves regenerating plans from the previous version while a new run is in flight', async () => {
    // Re-init keeps the plan id but resets contentKey; a plan that was never
    // synthesized has no contentKey while GRILLING → 202 above. A plan mid-run
    // WITH a leftover contentKey doesn't happen (init wipes it), but a READY
    // stale plan still serves its content:
    mockGetPlan.mockResolvedValue({ ...readyPlan, isStale: true, staleReason: 'New docs' });
    const res = await getHtmlContent(event);
    expect(statusOf(res)).toBe(200);
    expect(bodyOf(res)).toMatchObject({ isStale: true });
  });

  it('returns the HTML with version metadata on the happy path', async () => {
    const res = await getHtmlContent(event);

    expect(statusOf(res)).toBe(200);
    expect(mockLoadHtml).toHaveBeenCalledWith(readyPlan.contentKey);
    expect(bodyOf(res)).toEqual({
      ok: true,
      html: '<h1>Plan</h1>',
      contentKey: readyPlan.contentKey,
      version: 2,
      isStale: false,
      isUserEdited: true,
    });
  });
});
