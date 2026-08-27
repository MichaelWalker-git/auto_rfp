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

jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: () => ({ after: jest.fn() }),
  setAuditContext: jest.fn(),
}));

jest.mock('@/helpers/employee');

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './delete-employee';
import * as employeeHelpers from '@/helpers/employee';
import { setAuditContext } from '@/middleware/audit-middleware';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const mockDeleteEmployee = employeeHelpers.deleteEmployee as jest.MockedFunction<
  typeof employeeHelpers.deleteEmployee
>;

const makeEvent = (query?: Record<string, string>): AuthedEvent =>
  ({ queryStringParameters: query } as unknown as AuthedEvent);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('delete-employee baseHandler', () => {
  it('deletes and returns 200 — never blocked by plan-team references (BR3.1)', async () => {
    mockDeleteEmployee.mockResolvedValue(true);

    const res = (await baseHandler(
      makeEvent({ orgId: 'org-123', id: 'emp-1' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(200);
    expect(mockDeleteEmployee).toHaveBeenCalledWith('org-123', 'emp-1');
    expect(JSON.parse(res.body ?? '{}')).toEqual({ ok: true, id: 'emp-1' });
    expect(setAuditContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'EMPLOYEE_DELETED', resourceId: 'emp-1', orgId: 'org-123' }),
    );
  });

  it('returns 400 when orgId or id is missing', async () => {
    const noOrg = (await baseHandler(makeEvent({ id: 'emp-1' }))) as APIGatewayProxyStructuredResultV2;
    const noId = (await baseHandler(makeEvent({ orgId: 'org-123' }))) as APIGatewayProxyStructuredResultV2;

    expect(noOrg.statusCode).toBe(400);
    expect(noId.statusCode).toBe(400);
    expect(mockDeleteEmployee).not.toHaveBeenCalled();
  });

  it('returns 404 when the employee does not exist', async () => {
    mockDeleteEmployee.mockResolvedValue(false);

    const res = (await baseHandler(
      makeEvent({ orgId: 'org-123', id: 'missing' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(404);
    expect(setAuditContext).not.toHaveBeenCalled();
  });

  it('returns 404 for a record in another org — org scope guard (BR2.3)', async () => {
    mockDeleteEmployee.mockResolvedValue(false);

    const res = (await baseHandler(
      makeEvent({ orgId: 'other-org', id: 'emp-1' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(mockDeleteEmployee).toHaveBeenCalledWith('other-org', 'emp-1');
    expect(res.statusCode).toBe(404);
  });
});
