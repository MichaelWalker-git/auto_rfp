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

const mockSqsSend = jest.fn();
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn(() => ({ send: mockSqsSend })),
  SendMessageCommand: jest.fn((params) => ({ type: 'SendMessage', params })),
}));

jest.mock('@/helpers/employee-import', () => {
  const actual = jest.requireActual('@/helpers/employee-import');
  return {
    ImportRunAlreadyRunningError: actual.ImportRunAlreadyRunningError,
    createImportRun: jest.fn(),
    completeImportRun: jest.fn(),
  };
});
jest.mock('@/helpers/extraction', () => ({
  createExtractionJobRecord: jest.fn(),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.EXTRACTION_QUEUE_URL = 'https://sqs.test/queue';

import { baseHandler } from './trigger-employee-import';
import {
  createImportRun,
  completeImportRun,
  ImportRunAlreadyRunningError,
} from '@/helpers/employee-import';
import { createExtractionJobRecord } from '@/helpers/extraction';
import { setAuditContext } from '@/middleware/audit-middleware';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import type { APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import type { EmployeeImportRunItem, ExtractionJob } from '@auto-rfp/core';

const mockCreateImportRun = createImportRun as jest.MockedFunction<typeof createImportRun>;
const mockCompleteImportRun = completeImportRun as jest.MockedFunction<typeof completeImportRun>;
const mockCreateJob = createExtractionJobRecord as jest.MockedFunction<
  typeof createExtractionJobRecord
>;

const makeEvent = (body: unknown): AuthedEvent =>
  ({
    body: typeof body === 'string' ? body : JSON.stringify(body),
    auth: { userId: 'user-789' },
  } as unknown as AuthedEvent);

const runItem = (overrides: Partial<EmployeeImportRunItem> = {}): EmployeeImportRunItem => ({
  importRunId: 'run-1',
  orgId: 'org-123',
  status: 'RUNNING',
  documentsScanned: 0,
  cvsDetected: 0,
  employeesCreated: 0,
  employeesUpdated: 0,
  failedDocuments: [],
  triggeredBy: 'user-789',
  startedAt: '2026-08-19T10:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSqsSend.mockResolvedValue({});
  mockCreateJob.mockResolvedValue({ jobId: 'job-1', orgId: 'org-123' } as ExtractionJob);
});

describe('trigger-employee-import baseHandler', () => {
  it('creates a run, enqueues an EMPLOYEE extraction job, and returns 202 (happy path)', async () => {
    mockCreateImportRun.mockResolvedValue(runItem());

    const res = (await baseHandler(
      makeEvent({ orgId: 'org-123' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(202);
    expect(mockCreateImportRun).toHaveBeenCalledWith('org-123', 'user-789');
    expect(mockCreateJob).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-123', targetType: 'EMPLOYEE' }),
      'user-789',
    );
    const sentBody = JSON.parse(mockSqsSend.mock.calls[0][0].params.MessageBody);
    expect(sentBody).toEqual({ jobId: 'job-1', orgId: 'org-123', importRunId: 'run-1' });
    expect(JSON.parse(res.body ?? '{}').run.importRunId).toBe('run-1');
    expect(setAuditContext).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: 'EMPLOYEE_IMPORT_STARTED', resourceId: 'run-1' }),
    );
  });

  it('returns 409 with guidance and the running run while an import is RUNNING (BR1.1)', async () => {
    mockCreateImportRun.mockRejectedValue(
      new ImportRunAlreadyRunningError(runItem({ importRunId: 'run-live' })),
    );

    const res = (await baseHandler(
      makeEvent({ orgId: 'org-123' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body ?? '{}');
    expect(body.message).toContain('already running');
    expect(body.run.importRunId).toBe('run-live');
    expect(mockCreateJob).not.toHaveBeenCalled();
    expect(mockSqsSend).not.toHaveBeenCalled();
  });

  it('returns 400 when orgId is missing', async () => {
    const res = (await baseHandler(makeEvent({}))) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body ?? '{}').issues?.[0]?.path).toEqual(['orgId']);
    expect(mockCreateImportRun).not.toHaveBeenCalled();
  });

  it('closes the run FAILED and returns 500 when the job cannot be enqueued', async () => {
    mockCreateImportRun.mockResolvedValue(runItem());
    mockSqsSend.mockRejectedValue(new Error('SQS unavailable'));

    const res = (await baseHandler(
      makeEvent({ orgId: 'org-123' }),
    )) as APIGatewayProxyStructuredResultV2;

    expect(res.statusCode).toBe(500);
    expect(mockCompleteImportRun).toHaveBeenCalledWith('org-123', 'run-1', { status: 'FAILED' });
    expect(setAuditContext).not.toHaveBeenCalled();
  });
});
