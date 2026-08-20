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
const mockListMessages = jest.fn();
jest.mock('@/helpers/solution-plan', () => {
  const actual = jest.requireActual('@/helpers/solution-plan');
  return {
    getSolutionPlanByOpportunity: (...a: unknown[]) => mockGetPlan(...a),
    listGrillingMessages: (...a: unknown[]) => mockListMessages(...a),
    toGrillingMessageItem: actual.toGrillingMessageItem,
  };
});

import { getTranscript } from './get-transcript';
import { PK_NAME, SK_NAME } from '@/constants/common';

const query = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };
const event = { queryStringParameters: query } as never;

const plan = {
  id: 'plan-1',
  ...query,
  status: 'GRILLING',
  isStale: false,
  runId: 'run-2',
  version: 0,
  isUserEdited: false,
};

const message = (id: string, runId: string) => ({
  [PK_NAME]: 'GRILLING_MESSAGE',
  [SK_NAME]: `plan-1#001#ts#${id}`,
  id,
  solutionPlanId: 'plan-1',
  runId,
  round: 1,
  role: 'GRILLER',
  content: `Question ${id}?`,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetPlan.mockResolvedValue(plan);
  mockListMessages.mockResolvedValue([]);
});

const statusOf = (res: unknown): number => (res as { statusCode: number }).statusCode;
const bodyOf = (res: unknown): Record<string, unknown> =>
  JSON.parse((res as { body: string }).body);

describe('get-transcript handler', () => {
  it('returns 400 when query params are missing', async () => {
    const res = await getTranscript({ queryStringParameters: {} } as never);
    expect(statusOf(res)).toBe(400);
  });

  it('returns 404 when no plan exists', async () => {
    mockGetPlan.mockResolvedValue(null);
    const res = await getTranscript(event);
    expect(statusOf(res)).toBe(404);
    expect(mockListMessages).not.toHaveBeenCalled();
  });

  it('returns only the current run’s messages, keys stripped (ADR-5)', async () => {
    mockListMessages.mockResolvedValue([
      message('m1', 'run-1'), // superseded run — zombie leftover
      message('m2', 'run-2'),
      message('m3', 'run-2'),
    ]);

    const res = await getTranscript(event);

    expect(statusOf(res)).toBe(200);
    expect(mockListMessages).toHaveBeenCalledWith('plan-1');
    const body = bodyOf(res) as { messages: Array<Record<string, unknown>> };
    expect(body).toMatchObject({ solutionPlanId: 'plan-1', runId: 'run-2', status: 'GRILLING' });
    expect(body.messages.map((m) => m.id)).toEqual(['m2', 'm3']);
    for (const m of body.messages) {
      expect(m).not.toHaveProperty(PK_NAME);
      expect(m).not.toHaveProperty(SK_NAME);
    }
  });

  it('returns an empty transcript right after init', async () => {
    const res = await getTranscript(event);
    expect(statusOf(res)).toBe(200);
    expect((bodyOf(res) as { messages: unknown[] }).messages).toEqual([]);
  });
});
