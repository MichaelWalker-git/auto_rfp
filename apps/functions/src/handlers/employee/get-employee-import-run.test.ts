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

jest.mock('@/helpers/employee-import', () => ({
  getLatestImportRun: jest.fn(),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './get-employee-import-run';
import { getLatestImportRun } from '@/helpers/employee-import';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { EmployeeImportRunItem } from '@auto-rfp/core';

const mockGetLatest = getLatestImportRun as jest.MockedFunction<typeof getLatestImportRun>;

const makeEvent = (queryStringParameters?: Record<string, string>): AuthedEvent =>
  ({ queryStringParameters, auth: { userId: 'user-789' } } as unknown as AuthedEvent);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('get-employee-import-run baseHandler', () => {
  it('returns the latest run for the org (happy path)', async () => {
    const run: EmployeeImportRunItem = {
      importRunId: 'run-1',
      orgId: 'org-123',
      status: 'COMPLETED_WITH_ERRORS',
      documentsScanned: 12,
      cvsDetected: 4,
      employeesCreated: 3,
      employeesUpdated: 1,
      failedDocuments: [{ documentName: 'broken.pdf', reason: 'UNREADABLE' }],
      triggeredBy: 'user-789',
      startedAt: '2026-08-19T10:00:00.000Z',
      completedAt: '2026-08-19T10:04:00.000Z',
    };
    mockGetLatest.mockResolvedValue(run);

    const res = (await baseHandler(
      makeEvent({ orgId: 'org-123' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(200);
    expect(mockGetLatest).toHaveBeenCalledWith('org-123');
    const body = JSON.parse(res.body ?? '{}');
    expect(body.run.importRunId).toBe('run-1');
    expect(body.run.failedDocuments).toHaveLength(1);
  });

  it('returns run: null when the org has never imported', async () => {
    mockGetLatest.mockResolvedValue(null);

    const res = (await baseHandler(
      makeEvent({ orgId: 'org-123' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body ?? '{}').run).toBeNull();
  });

  it('returns 400 when orgId is missing', async () => {
    const res = (await baseHandler(makeEvent())) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(400);
    expect(mockGetLatest).not.toHaveBeenCalled();
  });
});
