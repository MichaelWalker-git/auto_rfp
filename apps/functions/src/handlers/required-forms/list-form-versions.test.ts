jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});
jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h, TransientServiceError: class extends Error {} }));
jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({}),
  orgMembershipMiddleware: () => ({}),
  requirePermission: () => ({}),
  httpErrorMiddleware: () => ({}),
}));

const mockList = jest.fn();
jest.mock('@/helpers/required-form-version', () => ({
  listFormVersions: (...a: unknown[]) => mockList(...a),
}));

jest.mock('@/helpers/api', () => ({
  apiResponse: (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body) }),
  getOrgId: (e: { queryStringParameters?: Record<string, string> }) => e.queryStringParameters?.orgId,
}));

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { baseHandler } from './list-form-versions';

const version = {
  versionId: 'v1', formId: 'f', orgId: 'o', projectId: 'p', opportunityId: 'opp',
  versionNumber: 1, fields: [], source: 'MANUAL', createdAt: '2026-08-10T00:00:00.000Z',
};

const eventFor = (qs: Record<string, string>) =>
  ({ queryStringParameters: qs }) as unknown as APIGatewayProxyEventV2;

const validQuery = { orgId: 'o', projectId: 'p', opportunityId: 'opp', formId: 'f' };

beforeEach(() => {
  jest.clearAllMocks();
  mockList.mockResolvedValue([version]);
});

describe('list-form-versions handler', () => {
  it('returns 400 when orgId is missing', async () => {
    const res = await baseHandler(eventFor({ projectId: 'p', opportunityId: 'opp', formId: 'f' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 on invalid query', async () => {
    const res = await baseHandler(eventFor({ orgId: 'o' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns the version list with a count', async () => {
    const res = await baseHandler(eventFor(validQuery));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.count).toBe(1);
    expect(body.versions[0].versionId).toBe('v1');
  });
});
