jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (h: unknown) => h,
  TransientServiceError: class extends Error {},
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({}),
  orgMembershipMiddleware: () => ({}),
  requirePermission: () => ({}),
  httpErrorMiddleware: () => ({}),
}));

const mockDelete = jest.fn();
jest.mock('@/helpers/required-form', () => ({
  deleteRequiredForm: (...args: unknown[]) => mockDelete(...args),
}));

jest.mock('@/helpers/api', () => ({
  apiResponse: (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body) }),
  getOrgId: (event: { queryStringParameters?: Record<string, string> }) =>
    event.queryStringParameters?.orgId,
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './delete-required-form';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const eventFor = (role: 'ADMIN' | 'EDITOR' | 'VIEWER' | undefined, q: Record<string, string>) =>
  ({
    queryStringParameters: q,
    rbac: role ? { role, permissions: [] } : undefined,
  } as unknown as AuthedEvent);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('delete-required-form', () => {
  it('returns 400 when orgId is missing', async () => {
    const res = await baseHandler(eventFor('ADMIN', { projectId: 'p', opportunityId: 'o', formId: 'f' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 403 when caller is EDITOR', async () => {
    const res = await baseHandler(
      eventFor('EDITOR', { orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'f' }),
    );
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.body as string).message).toMatch(/admin/i);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('returns 403 when caller is VIEWER', async () => {
    const res = await baseHandler(
      eventFor('VIEWER', { orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'f' }),
    );
    expect(res.statusCode).toBe(403);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('returns 400 when query params are invalid', async () => {
    const res = await baseHandler(eventFor('ADMIN', { orgId: 'org' }));
    expect(res.statusCode).toBe(400);
  });

  it('deletes when caller is ADMIN', async () => {
    mockDelete.mockResolvedValueOnce(undefined);
    const res = await baseHandler(
      eventFor('ADMIN', { orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'f' }),
    );
    expect(res.statusCode).toBe(200);
    expect(mockDelete).toHaveBeenCalledWith({
      orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'f',
    });
  });
});
