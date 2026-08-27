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

import { baseHandler } from './create-employee';
import * as employeeHelpers from '@/helpers/employee';
import { setAuditContext } from '@/middleware/audit-middleware';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const mockCreateEmployee = employeeHelpers.createEmployee as jest.MockedFunction<
  typeof employeeHelpers.createEmployee
>;

const makeEvent = (body: unknown): AuthedEvent =>
  ({
    body: typeof body === 'string' ? body : JSON.stringify(body),
    auth: { userId: 'user-789' },
  } as unknown as AuthedEvent);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('create-employee baseHandler', () => {
  it('creates an employee and returns 201 (happy path)', async () => {
    mockCreateEmployee.mockResolvedValue({
      id: 'emp-1', orgId: 'org-123', name: 'Jane Smith', primaryRoles: ['PM'], secondaryRoles: [], certifications: [], source: 'MANUAL',
    });

    const res = (await baseHandler(
      makeEvent({ orgId: 'org-123', name: 'Jane Smith', primaryRoles: ['PM'] }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(201);
    expect(mockCreateEmployee).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-123', name: 'Jane Smith', primaryRoles: ['PM'] }),
      { createdBy: 'user-789' },
    );
    expect(JSON.parse(res.body ?? '{}').item.id).toBe('emp-1');
    expect(setAuditContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'EMPLOYEE_CREATED', resourceId: 'emp-1', orgId: 'org-123' }),
    );
  });

  it('returns 400 with field-level issues when the name is empty (BR1.1, BR4.3)', async () => {
    const res = (await baseHandler(
      makeEvent({ orgId: 'org-123', name: '   ' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body ?? '{}');
    expect(body.issues?.[0]?.path).toEqual(['name']);
    expect(mockCreateEmployee).not.toHaveBeenCalled();
  });

  it('returns 400 when orgId is missing from the body', async () => {
    const res = (await baseHandler(
      makeEvent({ name: 'Jane Smith' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body ?? '{}').issues?.[0]?.path).toEqual(['orgId']);
  });

  it('returns 400 on malformed JSON instead of a 500', async () => {
    const res = (await baseHandler(makeEvent('{not json'))) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(400);
    expect(mockCreateEmployee).not.toHaveBeenCalled();
  });
});
