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

const mockListWorkflowStates = jest.fn();
jest.mock('@/helpers/linear', () => ({
  listWorkflowStates: (...args: unknown[]) => mockListWorkflowStates(...args),
}));

import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { baseHandler } from './list-states';

const makeEvent = (orgId?: string): APIGatewayProxyEventV2 =>
  ({
    queryStringParameters: orgId ? { orgId } : null,
  }) as unknown as APIGatewayProxyEventV2;

describe('list-states', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the Linear workflow states for the org', async () => {
    const states = [{ id: 's1', name: 'Initial Approval', type: 'unstarted' }];
    mockListWorkflowStates.mockResolvedValue(states);

    const res = await baseHandler(makeEvent('org-1'));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body || '{}')).toEqual({ states });
    expect(mockListWorkflowStates).toHaveBeenCalledWith('org-1');
  });

  it('400s when orgId is missing', async () => {
    const res = await baseHandler(makeEvent());

    expect(res.statusCode).toBe(400);
    expect(mockListWorkflowStates).not.toHaveBeenCalled();
  });

  it('500s when the Linear lookup throws', async () => {
    mockListWorkflowStates.mockRejectedValue(new Error('boom'));

    const res = await baseHandler(makeEvent('org-1'));

    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body || '{}').error).toContain('Failed to list Linear workflow states');
  });
});
