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
const mockUploadHtml = jest.fn();
const mockUpdateContent = jest.fn();
jest.mock('@/helpers/solution-plan', () => {
  const actual = jest.requireActual('@/helpers/solution-plan');
  return {
    getSolutionPlanByOpportunity: (...a: unknown[]) => mockGetPlan(...a),
    uploadSolutionPlanHtml: (...a: unknown[]) => mockUploadHtml(...a),
    updateSolutionPlanContent: (...a: unknown[]) => mockUpdateContent(...a),
    toSolutionPlanItem: actual.toSolutionPlanItem,
  };
});

import { updateSolutionPlan } from './update-solution-plan';
import { PK_NAME, SK_NAME } from '@/constants/common';

const key = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };
const body = { ...key, htmlContent: '<h1>Edited plan</h1>' };

const makeEvent = (bodyJson: Record<string, unknown>) =>
  ({
    body: JSON.stringify(bodyJson),
    auth: { userId: 'user-9' },
  }) as never;

const readyPlan = {
  id: 'plan-1',
  ...key,
  status: 'READY',
  isStale: true,
  staleReason: 'Exec brief regenerated',
  runId: 'run-1',
  contentKey: 'org-1/proj-1/opp-1/solution-plan/v3/solution-plan.html',
  version: 3,
  isUserEdited: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPlan.mockResolvedValue(readyPlan);
  mockUploadHtml.mockResolvedValue('org-1/proj-1/opp-1/solution-plan/v4/solution-plan.html');
  mockUpdateContent.mockResolvedValue({
    ...readyPlan,
    [PK_NAME]: 'SOLUTION_PLAN',
    [SK_NAME]: 'org-1#proj-1#opp-1',
    version: 4,
    contentKey: 'org-1/proj-1/opp-1/solution-plan/v4/solution-plan.html',
    isUserEdited: true,
    editedBy: 'user-9',
    isStale: false,
    staleReason: '',
  });
});

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;
const bodyOf = (res: unknown): Record<string, unknown> =>
  JSON.parse((res as { body: string }).body);

describe('update-solution-plan handler', () => {
  it('returns 400 when htmlContent is missing', async () => {
    const res = await updateSolutionPlan(makeEvent(key));
    expect(statusOf(res)).toBe(400);
    expect(mockUploadHtml).not.toHaveBeenCalled();
  });

  it('returns 400 (not 500) when the body is malformed JSON', async () => {
    const res = await updateSolutionPlan({ body: '{not json', auth: { userId: 'user-9' } } as never);
    expect(statusOf(res)).toBe(400);
    expect(mockGetPlan).not.toHaveBeenCalled();
  });

  it('returns 400 when htmlContent is empty', async () => {
    const res = await updateSolutionPlan(makeEvent({ ...key, htmlContent: '' }));
    expect(statusOf(res)).toBe(400);
  });

  it('returns 404 when no plan exists', async () => {
    mockGetPlan.mockResolvedValue(null);
    const res = await updateSolutionPlan(makeEvent(body));
    expect(statusOf(res)).toBe(404);
    expect(mockUploadHtml).not.toHaveBeenCalled();
  });

  it.each(['GRILLING', 'GENERATING_SOT', 'FAILED'])(
    'returns 409 when the plan is %s (ADR-8: editable only when READY)',
    async (status) => {
      mockGetPlan.mockResolvedValue({ ...readyPlan, status });

      const res = await updateSolutionPlan(makeEvent(body));

      expect(statusOf(res)).toBe(409);
      expect(bodyOf(res)).toMatchObject({
        code: 'SOLUTION_PLAN_NOT_READY',
        solutionPlanStatus: status,
      });
      expect(mockUploadHtml).not.toHaveBeenCalled();
      expect(mockUpdateContent).not.toHaveBeenCalled();
    },
  );

  it('uploads a bumped S3 version and persists the edit on the happy path', async () => {
    const res = await updateSolutionPlan(makeEvent(body));

    expect(statusOf(res)).toBe(200);
    // Monotonic bump from the current counter (ADR-11)
    expect(mockUploadHtml).toHaveBeenCalledWith(key, 4, '<h1>Edited plan</h1>');
    expect(mockUpdateContent).toHaveBeenCalledWith(key, {
      version: 4,
      contentKey: 'org-1/proj-1/opp-1/solution-plan/v4/solution-plan.html',
      editedBy: 'user-9',
    });

    const { plan } = bodyOf(res) as { plan: Record<string, unknown> };
    expect(plan).toMatchObject({ version: 4, isUserEdited: true, isStale: false });
    expect(plan).not.toHaveProperty(PK_NAME);
    expect(plan).not.toHaveProperty(SK_NAME);
  });

  it('returns 409 when the conditional write fails mid-flight (regenerate or concurrent-edit race)', async () => {
    mockUpdateContent.mockResolvedValue(null);

    const res = await updateSolutionPlan(makeEvent(body));

    expect(statusOf(res)).toBe(409);
    expect(bodyOf(res)).toMatchObject({ code: 'SOLUTION_PLAN_CONFLICT' });
  });
});
