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
  GetCommand: jest.fn((params: unknown) => ({ type: 'Get', params })),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

// --- Now import ---
import { handler } from './get-extraction-job';
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

const mockJob = {
  jobId: 'job-123',
  orgId: 'org-123',
  sourceType: 'DIRECT_UPLOAD',
  targetType: 'PAST_PERFORMANCE',
  status: 'COMPLETED',
  totalItems: 2,
  processedItems: 2,
  successfulItems: 2,
  failedItems: 0,
  sourceFiles: [],
  draftsCreated: ['draft-1', 'draft-2'],
  errors: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'user-123',
};

// --- Tests ---
describe('get-extraction-job handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('Happy path', () => {
    it('should return 200 with job on valid request', async () => {
      mockSend.mockResolvedValueOnce({ Item: mockJob });

      const event = buildEvent({
        queryStringParameters: { orgId: 'org-123', jobId: 'job-123' },
      });

      const result = await handler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 200);
      expect(body.ok).toBe(true);
      expect(body.job).toBeDefined();
      expect(body.job.jobId).toBe('job-123');
      expect(body.job.status).toBe('COMPLETED');
    });

    it('should return job with all fields', async () => {
      mockSend.mockResolvedValueOnce({ Item: mockJob });

      const event = buildEvent({
        queryStringParameters: { orgId: 'org-123', jobId: 'job-123' },
      });

      const result = await handler(event);
      const body = parseBody(result as { body: string });

      expect(body.job.draftsCreated).toHaveLength(2);
      expect(body.job.sourceType).toBe('DIRECT_UPLOAD');
      expect(body.job.targetType).toBe('PAST_PERFORMANCE');
    });
  });

  describe('Validation errors', () => {
    it('should return 400 when orgId is missing', async () => {
      const event = buildEvent({
        queryStringParameters: { jobId: 'job-123' },
      });

      const result = await handler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 400);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('orgId');
    });

    it('should return 400 when jobId is missing', async () => {
      const event = buildEvent({
        queryStringParameters: { orgId: 'org-123' },
      });

      const result = await handler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 400);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('jobId');
    });

    it('should return 400 when no query params provided', async () => {
      const event = buildEvent({
        queryStringParameters: null,
      });

      const result = await handler(event);

      expect(result).toHaveProperty('statusCode', 400);
    });
  });

  describe('Not found', () => {
    it('should return 404 when job not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const event = buildEvent({
        queryStringParameters: { orgId: 'org-123', jobId: 'nonexistent-job' },
      });

      const result = await handler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 404);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('not found');
    });
  });

  describe('DynamoDB operations', () => {
    it('should call DynamoDB with correct parameters', async () => {
      mockSend.mockResolvedValueOnce({ Item: mockJob });

      const event = buildEvent({
        queryStringParameters: { orgId: 'org-123', jobId: 'job-456' },
      });

      await handler(event);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const getParams = mockSend.mock.calls[0][0].params;
      expect(getParams.TableName).toBe('test-table');
      expect(getParams.Key.partition_key).toBe('EXTRACTION_JOB');
      expect(getParams.Key.sort_key).toBe('org-123#job-456');
    });
  });
});
