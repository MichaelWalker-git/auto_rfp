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

const mockList = jest.fn();
jest.mock('@/helpers/questionnaire-version', () => ({
  listQuestionnaireVersions: (...a: unknown[]) => mockList(...a),
}));

import { baseHandler } from './list-questionnaire-versions';

const makeEvent = (query: Record<string, string>) =>
  ({ queryStringParameters: query }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue([]);
});

describe('list-questionnaire-versions handler', () => {
  it('returns 400 when orgId is missing', async () => {
    const res = await baseHandler(makeEvent({ projectId: 'p', opportunityId: 'o', documentId: 'd' }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 when required query params are missing', async () => {
    const res = await baseHandler(makeEvent({ orgId: 'o' }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('lists versions with a count envelope', async () => {
    mockList.mockResolvedValueOnce([
      {
        versionId: 'v2', documentId: 'd', orgId: 'o', projectId: 'p', opportunityId: 'opp',
        versionNumber: 2, snapshotFileKey: 'k2', source: 'AI_MASS_EDIT', createdAt: '2026-08-13T00:00:00.000Z',
      },
      {
        versionId: 'v1', documentId: 'd', orgId: 'o', projectId: 'p', opportunityId: 'opp',
        versionNumber: 1, snapshotFileKey: 'k1', source: 'MANUAL', createdAt: '2026-08-12T00:00:00.000Z',
      },
    ]);

    const res = await baseHandler(makeEvent({ orgId: 'o', projectId: 'p', opportunityId: 'opp', documentId: 'd' }));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.count).toBe(2);
    expect(body.versions).toHaveLength(2);
    expect(mockList).toHaveBeenCalledWith('o', 'p', 'opp', 'd');
  });
});
