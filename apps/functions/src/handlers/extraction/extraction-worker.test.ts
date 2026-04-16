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
  UpdateCommand: jest.fn((params: unknown) => ({ type: 'Update', params })),
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
}));

jest.mock('@/helpers/audit-log', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/helpers/secret', () => ({
  getHmacSecret: jest.fn().mockResolvedValue('mock-secret'),
}));

const mockExtractPastPerformance = jest.fn();
const mockExtractLaborRates = jest.fn();
const mockExtractBOMItems = jest.fn();
jest.mock('@/helpers/extraction-processor', () => ({
  extractPastPerformanceFromDocument: mockExtractPastPerformance,
  extractLaborRatesFromDocument: mockExtractLaborRates,
  extractBOMItemsFromDocument: mockExtractBOMItems,
}));

const mockGetExtractionJobRecord = jest.fn();
const mockUpdateExtractionJobProgress = jest.fn();
jest.mock('@/helpers/extraction', () => ({
  getExtractionJobRecord: mockGetExtractionJobRecord,
  updateExtractionJobProgress: mockUpdateExtractionJobProgress,
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

// --- Now import ---
import { handler } from './extraction-worker';
import type { SQSEvent, SQSRecord } from 'aws-lambda';

// --- Test helpers ---
const buildSQSEvent = (records: Partial<SQSRecord>[]): SQSEvent => ({
  Records: records.map((r, i) => ({
    messageId: `msg-${i}`,
    receiptHandle: `receipt-${i}`,
    body: '{}',
    attributes: {} as SQSRecord['attributes'],
    messageAttributes: {},
    md5OfBody: 'md5',
    eventSource: 'aws:sqs',
    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789:test-queue',
    awsRegion: 'us-east-1',
    ...r,
  })),
});

const mockJob = {
  jobId: 'job-123',
  orgId: 'org-123',
  sourceType: 'DIRECT_UPLOAD',
  targetType: 'PAST_PERFORMANCE',
  status: 'PENDING',
  totalItems: 1,
  processedItems: 0,
  sourceFiles: [{ fileName: 'test.pdf', s3Key: 's3://bucket/test.pdf', fileSize: 1024 }],
  errors: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  createdBy: 'user-123',
};

// --- Tests ---
describe('extraction-worker handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockGetExtractionJobRecord.mockReset();
    mockUpdateExtractionJobProgress.mockReset();
    mockExtractPastPerformance.mockReset();
    mockExtractLaborRates.mockReset();
    mockExtractBOMItems.mockReset();
  });

  describe('Happy path', () => {
    it('should process extraction job successfully for PAST_PERFORMANCE', async () => {
      mockGetExtractionJobRecord.mockResolvedValueOnce(mockJob);
      mockUpdateExtractionJobProgress.mockResolvedValue({});
      mockExtractPastPerformance.mockResolvedValueOnce(['draft-1']);

      const event = buildSQSEvent([
        { body: JSON.stringify({ jobId: 'job-123', orgId: 'org-123' }) },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockExtractPastPerformance).toHaveBeenCalledTimes(1);
    });

    it('should process extraction job for LABOR_RATE type', async () => {
      const laborJob = { ...mockJob, targetType: 'LABOR_RATE' };
      mockGetExtractionJobRecord.mockResolvedValueOnce(laborJob);
      mockUpdateExtractionJobProgress.mockResolvedValue({});
      mockExtractLaborRates.mockResolvedValueOnce(['labor-draft-1']);

      const event = buildSQSEvent([
        { body: JSON.stringify({ jobId: 'job-123', orgId: 'org-123' }) },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockExtractLaborRates).toHaveBeenCalledTimes(1);
    });

    it('should process extraction job for BOM_ITEM type', async () => {
      const bomJob = { ...mockJob, targetType: 'BOM_ITEM' };
      mockGetExtractionJobRecord.mockResolvedValueOnce(bomJob);
      mockUpdateExtractionJobProgress.mockResolvedValue({});
      mockExtractBOMItems.mockResolvedValueOnce(['bom-draft-1']);

      const event = buildSQSEvent([
        { body: JSON.stringify({ jobId: 'job-123', orgId: 'org-123' }) },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockExtractBOMItems).toHaveBeenCalledTimes(1);
    });

    it('should process multiple files in a job', async () => {
      const multiFileJob = {
        ...mockJob,
        sourceFiles: [
          { fileName: 'file1.pdf', s3Key: 's3://bucket/file1.pdf', fileSize: 1024 },
          { fileName: 'file2.pdf', s3Key: 's3://bucket/file2.pdf', fileSize: 2048 },
        ],
      };
      mockGetExtractionJobRecord.mockResolvedValueOnce(multiFileJob);
      mockUpdateExtractionJobProgress.mockResolvedValue({});
      mockExtractPastPerformance
        .mockResolvedValueOnce(['draft-1'])
        .mockResolvedValueOnce(['draft-2']);

      const event = buildSQSEvent([
        { body: JSON.stringify({ jobId: 'job-123', orgId: 'org-123' }) },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockExtractPastPerformance).toHaveBeenCalledTimes(2);
    });
  });

  describe('Job not found', () => {
    it('should skip processing when job not found (not retry)', async () => {
      mockGetExtractionJobRecord.mockResolvedValueOnce(null);

      const event = buildSQSEvent([
        { body: JSON.stringify({ jobId: 'nonexistent', orgId: 'org-123' }) },
      ]);

      const result = await handler(event);

      // Should not add to failures - skip the message
      expect(result.batchItemFailures).toHaveLength(0);
    });
  });

  describe('Job already completed', () => {
    it('should skip job in COMPLETED state', async () => {
      const completedJob = { ...mockJob, status: 'COMPLETED' };
      mockGetExtractionJobRecord.mockResolvedValueOnce(completedJob);

      const event = buildSQSEvent([
        { body: JSON.stringify({ jobId: 'job-123', orgId: 'org-123' }) },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockExtractPastPerformance).not.toHaveBeenCalled();
    });

    it('should skip job in FAILED state', async () => {
      const failedJob = { ...mockJob, status: 'FAILED' };
      mockGetExtractionJobRecord.mockResolvedValueOnce(failedJob);

      const event = buildSQSEvent([
        { body: JSON.stringify({ jobId: 'job-123', orgId: 'org-123' }) },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockExtractPastPerformance).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should add message to batch failures on processing error', async () => {
      mockGetExtractionJobRecord.mockRejectedValueOnce(new Error('DynamoDB error'));

      const event = buildSQSEvent([
        { messageId: 'failed-msg', body: JSON.stringify({ jobId: 'job-123', orgId: 'org-123' }) },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe('failed-msg');
    });

    it('should continue processing other messages when one fails', async () => {
      // First message fails, second succeeds
      mockGetExtractionJobRecord
        .mockRejectedValueOnce(new Error('DynamoDB error'))
        .mockResolvedValueOnce(mockJob);
      mockUpdateExtractionJobProgress.mockResolvedValue({});
      mockExtractPastPerformance.mockResolvedValueOnce(['draft-1']);

      const event = buildSQSEvent([
        { messageId: 'msg-fail', body: JSON.stringify({ jobId: 'job-fail', orgId: 'org-123' }) },
        { messageId: 'msg-success', body: JSON.stringify({ jobId: 'job-123', orgId: 'org-123' }) },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(1);
      expect(result.batchItemFailures[0].itemIdentifier).toBe('msg-fail');
    });

    it('should handle file extraction error and continue', async () => {
      const multiFileJob = {
        ...mockJob,
        sourceFiles: [
          { fileName: 'file1.pdf', s3Key: 's3://bucket/file1.pdf', fileSize: 1024 },
          { fileName: 'file2.pdf', s3Key: 's3://bucket/file2.pdf', fileSize: 2048 },
        ],
      };
      mockGetExtractionJobRecord.mockResolvedValueOnce(multiFileJob);
      mockUpdateExtractionJobProgress.mockResolvedValue({});
      
      // First file fails, second succeeds
      mockExtractPastPerformance
        .mockRejectedValueOnce(new Error('Extraction failed'))
        .mockResolvedValueOnce(['draft-2']);

      const event = buildSQSEvent([
        { body: JSON.stringify({ jobId: 'job-123', orgId: 'org-123' }) },
      ]);

      const result = await handler(event);

      // Message should succeed overall (partial extraction)
      expect(result.batchItemFailures).toHaveLength(0);
      expect(mockExtractPastPerformance).toHaveBeenCalledTimes(2);
    });
  });

  describe('Multiple messages', () => {
    it('should process multiple SQS messages in batch', async () => {
      mockGetExtractionJobRecord
        .mockResolvedValueOnce(mockJob)
        .mockResolvedValueOnce({ ...mockJob, jobId: 'job-456' });
      mockUpdateExtractionJobProgress.mockResolvedValue({});
      mockExtractPastPerformance
        .mockResolvedValueOnce(['draft-1'])
        .mockResolvedValueOnce(['draft-2']);

      const event = buildSQSEvent([
        { body: JSON.stringify({ jobId: 'job-123', orgId: 'org-123' }) },
        { body: JSON.stringify({ jobId: 'job-456', orgId: 'org-123' }) },
      ]);

      const result = await handler(event);

      expect(result.batchItemFailures).toHaveLength(0);
    });
  });
});
