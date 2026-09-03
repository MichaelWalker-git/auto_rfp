// Mock middy before importing the handler.
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: jest.fn(() => ({ before: jest.fn() })),
  orgMembershipMiddleware: jest.fn(() => ({ before: jest.fn() })),
  requirePermission: jest.fn(() => ({ before: jest.fn() })),
  httpErrorMiddleware: jest.fn(() => ({ onError: jest.fn() })),
}));

const mockListTeamMembers = jest.fn();
jest.mock('@/helpers/linear', () => ({
  listTeamMembers: (...args: unknown[]) => mockListTeamMembers(...args),
}));

import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { baseHandler } from './list-users';

const makeEvent = (orgId?: string): APIGatewayProxyEventV2 =>
  ({
    queryStringParameters: orgId ? { orgId } : null,
  }) as unknown as APIGatewayProxyEventV2;

describe('list-users', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the Linear team members for the org', async () => {
    const users = [{ id: 'u1', name: 'Ada', email: 'ada@x.com' }];
    mockListTeamMembers.mockResolvedValue(users);

    const res = await baseHandler(makeEvent('org-1'));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body || '{}')).toEqual({ users });
    expect(mockListTeamMembers).toHaveBeenCalledWith('org-1');
  });

  it('400s when orgId is missing', async () => {
    const res = await baseHandler(makeEvent());

    expect(res.statusCode).toBe(400);
    expect(mockListTeamMembers).not.toHaveBeenCalled();
  });

  it('500s when the Linear lookup throws', async () => {
    mockListTeamMembers.mockRejectedValue(new Error('Linear team ID not configured'));

    const res = await baseHandler(makeEvent('org-1'));

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body || '{}').error).toContain('Failed to list Linear team members');
  });
});
