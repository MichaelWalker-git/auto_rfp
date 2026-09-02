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

import { baseHandler } from './get-employee';
import * as employeeHelpers from '@/helpers/employee';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';

const mockGetEmployee = employeeHelpers.getEmployee as jest.MockedFunction<
  typeof employeeHelpers.getEmployee
>;

const makeEvent = (query?: Record<string, string>): AuthedEvent =>
  ({ queryStringParameters: query } as unknown as AuthedEvent);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('get-employee baseHandler', () => {
  it('returns the employee (happy path)', async () => {
    mockGetEmployee.mockResolvedValue({
      id: 'emp-1', orgId: 'org-123', name: 'Jane', primaryRoles: [], secondaryRoles: [], certifications: [], source: 'MANUAL',
    });

    const res = (await baseHandler(
      makeEvent({ orgId: 'org-123', id: 'emp-1' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(mockGetEmployee).toHaveBeenCalledWith('org-123', 'emp-1');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body ?? '{}').item.id).toBe('emp-1');
  });

  it('returns 400 when orgId or id is missing', async () => {
    const noOrg = (await baseHandler(makeEvent({ id: 'emp-1' }))) as APIGatewayProxyStructuredResultV2;
    const noId = (await baseHandler(makeEvent({ orgId: 'org-123' }))) as APIGatewayProxyStructuredResultV2;

    expect(noOrg.statusCode).toBe(400);
    expect(noId.statusCode).toBe(400);
    expect(mockGetEmployee).not.toHaveBeenCalled();
  });

  it('returns 404 when the employee does not exist', async () => {
    mockGetEmployee.mockResolvedValue(null);

    const res = (await baseHandler(
      makeEvent({ orgId: 'org-123', id: 'missing' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(404);
  });

  it('returns 404 for a record in another org — no cross-org disclosure (BR2.3)', async () => {
    // The helper scopes the lookup by orgId, so a foreign record resolves to null.
    mockGetEmployee.mockResolvedValue(null);

    const res = (await baseHandler(
      makeEvent({ orgId: 'other-org', id: 'emp-1' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(mockGetEmployee).toHaveBeenCalledWith('other-org', 'emp-1');
    expect(res.statusCode).toBe(404);
  });
});
