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

// isConditionalCheckFailed must keep its real semantics for the 404 mapping;
// mock the module (db.ts requires env at import) but restore the predicate.
jest.mock('@/helpers/db', () => ({
  isConditionalCheckFailed: (err: unknown) =>
    typeof err === 'object' && err !== null &&
    (err as { name?: string }).name === 'ConditionalCheckFailedException',
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './update-employee';
import * as employeeHelpers from '@/helpers/employee';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const mockUpdateEmployee = employeeHelpers.updateEmployee as jest.MockedFunction<
  typeof employeeHelpers.updateEmployee
>;

const makeEvent = (body: unknown): AuthedEvent =>
  ({ body: JSON.stringify(body) } as unknown as AuthedEvent);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('update-employee baseHandler', () => {
  it('patches an employee and returns 200 (happy path)', async () => {
    mockUpdateEmployee.mockResolvedValue({
      id: 'emp-1', orgId: 'org-123', name: 'Jane Doe', primaryRoles: [], secondaryRoles: [], certifications: [], source: 'MANUAL',
    });

    const res = (await baseHandler(
      makeEvent({ orgId: 'org-123', id: 'emp-1', patch: { name: 'Jane Doe' } }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(200);
    expect(mockUpdateEmployee).toHaveBeenCalledWith('org-123', 'emp-1', { name: 'Jane Doe' });
    expect(JSON.parse(res.body ?? '{}').item.name).toBe('Jane Doe');
  });

  it('returns 400 with field-level issues on an invalid patch (BR4.3)', async () => {
    const res = (await baseHandler(
      makeEvent({ orgId: 'org-123', id: 'emp-1', patch: { location: 'REMOTE' } }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body ?? '{}').issues?.[0]?.path).toEqual(['patch', 'location']);
    expect(mockUpdateEmployee).not.toHaveBeenCalled();
  });

  it('strips orgId from the patch — identity is immutable (BR3.2)', async () => {
    mockUpdateEmployee.mockResolvedValue({
      id: 'emp-1', orgId: 'org-123', name: 'Jane', primaryRoles: [], secondaryRoles: [], certifications: [], source: 'MANUAL',
    });

    await baseHandler(
      makeEvent({ orgId: 'org-123', id: 'emp-1', patch: { orgId: 'other-org', name: 'Jane' } }),
    );

    expect(mockUpdateEmployee).toHaveBeenCalledWith('org-123', 'emp-1', { name: 'Jane' });
  });

  it('returns 404 when the record is missing or belongs to another org (BR2.3)', async () => {
    const err = new Error('conditional failed');
    err.name = 'ConditionalCheckFailedException';
    mockUpdateEmployee.mockRejectedValue(err);

    const res = (await baseHandler(
      makeEvent({ orgId: 'other-org', id: 'emp-1', patch: { name: 'X' } }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(404);
  });

  it('rethrows unexpected errors for the error middleware', async () => {
    mockUpdateEmployee.mockRejectedValue(new Error('dynamo down'));

    await expect(
      baseHandler(makeEvent({ orgId: 'org-123', id: 'emp-1', patch: { name: 'X' } })),
    ).rejects.toThrow('dynamo down');
  });
});
