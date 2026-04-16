// --- Mocks MUST come before imports ---

jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => {
    const wrapped = (...args: unknown[]) => (handler as (...args: unknown[]) => unknown)(...args);
    wrapped.use = jest.fn().mockReturnValue(wrapped);
    return wrapped;
  };
  return { __esModule: true, default: middy };
});

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  PutCommand: jest.fn((params: unknown) => ({ type: 'Put', params })),
}));

const mockSqsSend = jest.fn();
jest.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: jest.fn(() => ({ send: mockSqsSend })),
  SendMessageCommand: jest.fn((params: unknown) => ({ type: 'SendMessage', params })),
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-job-uuid'),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
}));

jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ before: jest.fn(), after: jest.fn() })),
  setAuditContext: jest.fn(),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.EXTRACTION_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/test-queue';

// --- Now import ---
import { handler } from './start-extraction-job';
import { setAuditContext } from '@/middleware/audit-middleware';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

// --- Test helpers ---
const buildEvent = (overrides: Partial<AuthedEvent> = {}): AuthedEvent =>
  ({
    body: null,
    headers: {},
    queryStringParameters: null,
    pathParameters: null,
    requestContext: {
      http: { sourceIp: '127.0.0.1', userAgent: 'test' },
    } as AuthedEvent['requestContext'],
    auth: {
      userId: 'user-123',
      userName: 'Test User',
      orgId: 'org-123',
      claims: {},
    },
    ...overrides,
  }) as AuthedEvent;

const parseBody = (result: { body?: string }) => JSON.parse(result.body ?? '{}');

// --- Tests ---
describe('start-extraction-job handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockSqsSend.mockReset();
  });

  describe('Happy path', () => {
    it('should return 201 on valid input and create job', async () => {
      mockSend.mockResolvedValueOnce({}); // PutCommand
      mockSqsSend.mockResolvedValueOnce({}); // SendMessageCommand

      const event = buildEvent({
        body: JSON.stringify({
          orgId: '550e8400-e29b-41d4-a716-446655440000',
          sourceType: 'DIRECT_UPLOAD',
          targetType: 'PAST_PERFORMANCE',
          sourceFiles: [
            { fileName: 'test.pdf', s3Key: 'extraction-sources/test.pdf', fileSize: 1024 },
          ],
        }),
      });

      const result = await handler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 201);
      expect(body.ok).toBe(true);
      expect(body.job).toBeDefined();
      expect(body.job.jobId).toBe('mock-job-uuid');
      expect(body.job.status).toBe('PENDING');
    });

    it('should queue job for async processing', async () => {
      mockSend.mockResolvedValueOnce({});
      mockSqsSend.mockResolvedValueOnce({});

      const event = buildEvent({
        body: JSON.stringify({
          orgId: '550e8400-e29b-41d4-a716-446655440000',
          sourceType: 'DIRECT_UPLOAD',
          targetType: 'LABOR_RATE',
          sourceFiles: [
            { fileName: 'rates.xlsx', s3Key: 'extraction-sources/rates.xlsx', fileSize: 2048 },
          ],
        }),
      });

      await handler(event);

      expect(mockSqsSend).toHaveBeenCalledTimes(1);
    });

    it('should set audit context on success', async () => {
      mockSend.mockResolvedValueOnce({});
      mockSqsSend.mockResolvedValueOnce({});

      const event = buildEvent({
        body: JSON.stringify({
          orgId: '550e8400-e29b-41d4-a716-446655440000',
          sourceType: 'DIRECT_UPLOAD',
          targetType: 'BOM_ITEM',
          sourceFiles: [],
        }),
      });

      await handler(event);

      expect(setAuditContext).toHaveBeenCalledWith(
        event,
        expect.objectContaining({
          action: 'EXTRACTION_JOB_STARTED',
          resource: 'extraction_job',
          resourceId: 'mock-job-uuid',
        }),
      );
    });
  });

  describe('Validation errors', () => {
    it('should return 400 when orgId is missing', async () => {
      const event = buildEvent({
        body: JSON.stringify({
          sourceType: 'DIRECT_UPLOAD',
          targetType: 'PAST_PERFORMANCE',
        }),
      });

      const result = await handler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 400);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('Validation');
    });

    it('should return 400 when sourceType is invalid', async () => {
      const event = buildEvent({
        body: JSON.stringify({
          orgId: '550e8400-e29b-41d4-a716-446655440000',
          sourceType: 'INVALID_TYPE',
          targetType: 'PAST_PERFORMANCE',
        }),
      });

      const result = await handler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 400);
      expect(body.ok).toBe(false);
    });

    it('should return 400 when targetType is invalid', async () => {
      const event = buildEvent({
        body: JSON.stringify({
          orgId: '550e8400-e29b-41d4-a716-446655440000',
          sourceType: 'DIRECT_UPLOAD',
          targetType: 'INVALID_TARGET',
        }),
      });

      const result = await handler(event);

      expect(result).toHaveProperty('statusCode', 400);
    });

    it('should return 400 when body is empty', async () => {
      const event = buildEvent({ body: '{}' });

      const result = await handler(event);

      expect(result).toHaveProperty('statusCode', 400);
    });
  });

  describe('DynamoDB operations', () => {
    it('should call DynamoDB with correct table name', async () => {
      mockSend.mockResolvedValueOnce({});
      mockSqsSend.mockResolvedValueOnce({});

      const event = buildEvent({
        body: JSON.stringify({
          orgId: '550e8400-e29b-41d4-a716-446655440000',
          sourceType: 'DIRECT_UPLOAD',
          targetType: 'PAST_PERFORMANCE',
          sourceFiles: [],
        }),
      });

      await handler(event);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const putParams = mockSend.mock.calls[0][0].params;
      expect(putParams.TableName).toBe('test-table');
    });
  });
});
