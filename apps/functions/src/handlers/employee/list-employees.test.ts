// Mock middy and platform modules before importing the handler
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({ before: jest.fn() }),
  orgMembershipMiddleware: () => ({ before: jest.fn() }),
  requirePermission: () => ({ before: jest.fn() }),
  httpErrorMiddleware: () => ({ onError: jest.fn() }),
}));

jest.mock('@/helpers/employee');

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './list-employees';
import * as employeeHelpers from '@/helpers/employee';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const mockListEmployeesByOrg = employeeHelpers.listEmployeesByOrg as jest.MockedFunction<
  typeof employeeHelpers.listEmployeesByOrg
>;

const makeEvent = (query?: Record<string, string>): AuthedEvent =>
  ({ queryStringParameters: query } as unknown as AuthedEvent);

const parseBody = (res: unknown) =>
  JSON.parse((res as APIGatewayProxyStructuredResultV2).body ?? '{}');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('list-employees baseHandler', () => {
  it('returns the org-scoped employee list (happy path)', async () => {
    mockListEmployeesByOrg.mockResolvedValue([
      { id: 'emp-1', orgId: 'org-123', name: 'Jane', primaryRoles: [], secondaryRoles: [], certifications: [], source: 'MANUAL' },
    ]);

    const res = (await baseHandler(makeEvent({ orgId: 'org-123' }))) as APIGatewayProxyStructuredResultV2;

    expect(mockListEmployeesByOrg).toHaveBeenCalledWith('org-123');
    expect(res.statusCode).toBe(200);
    const body = parseBody(res);
    expect(body.items).toHaveLength(1);
    expect(body.count).toBe(1);
  });

  it('returns 400 when orgId is missing (BR2.3 — org scope required)', async () => {
    const res = (await baseHandler(makeEvent())) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(400);
    expect(mockListEmployeesByOrg).not.toHaveBeenCalled();
  });

  it('returns an empty list (not an error) when the org has no employees', async () => {
    mockListEmployeesByOrg.mockResolvedValue([]);

    const res = (await baseHandler(makeEvent({ orgId: 'org-123' }))) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(200);
    expect(parseBody(res)).toEqual({ items: [], count: 0 });
  });

  it('propagates helper failures to the error middleware (no silent success)', async () => {
    mockListEmployeesByOrg.mockRejectedValue(new Error('dynamo down'));

    await expect(baseHandler(makeEvent({ orgId: 'org-123' }))).rejects.toThrow('dynamo down');
  });
});
