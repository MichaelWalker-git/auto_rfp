// Mock middy before importing handlers (ESM compatibility)
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

// Mock uuid (ESM compatibility)
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

// Mock AWS SDK — use var so it is hoisted along with jest.mock
// eslint-disable-next-line no-var
var mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  DeleteCommand: jest.fn((params) => ({ type: 'Delete', params })),
  BatchWriteCommand: jest.fn((params) => ({ type: 'BatchWrite', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
}));

// Mock S3 client — use var so it is hoisted along with jest.mock
// eslint-disable-next-line no-var
var mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  DeleteObjectCommand: jest.fn((params) => ({ type: 'S3Delete', params })),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.DOCUMENTS_BUCKET = 'test-bucket';

import { baseHandler } from './delete-question-file';
import { deleteQuestionFileWithCascade } from '@/helpers/questionFile';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

// Unused imports removed — deleteQuestionFileWithCascade is tested directly
// createQuestionFile is not used in this test suite

describe('delete-question-file', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockS3Send.mockReset();
  });

  // ─── deleteQuestionFileWithCascade helper ─────────────────────────────────────

  describe('deleteQuestionFileWithCascade', () => {
    it('returns null when question file does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await deleteQuestionFileWithCascade('proj-1', 'opp-1', 'qf-1');

      expect(result).toBeNull();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('deletes question file, cascades questions, and deletes S3 objects', async () => {
      // GetCommand → found with fileKey and textFileKey
      mockSend.mockResolvedValueOnce({
        Item: {
          partition_key: 'QUESTION_FILE',
          sort_key: 'proj-1#opp-1#qf-1',
          questionFileId: 'qf-1',
          fileKey: 'uploads/rfp.pdf',
          textFileKey: 'text/rfp.txt',
          status: 'PROCESSED',
        },
      });
      // S3 delete fileKey
      mockS3Send.mockResolvedValueOnce({});
      // S3 delete textFileKey
      mockS3Send.mockResolvedValueOnce({});
      // QueryCommand (begins_with) → 2 question keys
      mockSend.mockResolvedValueOnce({
        Items: [
          { partition_key: 'QUESTION', sort_key: 'proj-1#opp-1#qf-1#q1' },
          { partition_key: 'QUESTION', sort_key: 'proj-1#opp-1#qf-1#q2' },
        ],
        LastEvaluatedKey: undefined,
      });
      // BatchWriteCommand → delete 2 questions
      mockSend.mockResolvedValueOnce({});
      // DeleteCommand → delete question file
      mockSend.mockResolvedValueOnce({});

      const result = await deleteQuestionFileWithCascade('proj-1', 'opp-1', 'qf-1');

      expect(result).toEqual({
        questionFileId: 'qf-1',
        sk: 'proj-1#opp-1#qf-1',
        questionsDeleted: 2,
        s3: {
          bucket: 'test-bucket',
          keysRequested: ['uploads/rfp.pdf', 'text/rfp.txt'],
          results: [
            { key: 'uploads/rfp.pdf', ok: true },
            { key: 'text/rfp.txt', ok: true },
          ],
        },
      });
    });

    it('handles S3 delete failure gracefully (best-effort)', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          partition_key: 'QUESTION_FILE',
          sort_key: 'proj-1#opp-1#qf-1',
          questionFileId: 'qf-1',
          fileKey: 'uploads/rfp.pdf',
          status: 'PROCESSED',
        },
      });
      // S3 delete fails
      mockS3Send.mockRejectedValueOnce(new Error('S3 access denied'));
      // QueryCommand → no questions
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // DeleteCommand → delete question file
      mockSend.mockResolvedValueOnce({});

      const result = await deleteQuestionFileWithCascade('proj-1', 'opp-1', 'qf-1');

      expect(result).not.toBeNull();
      expect(result!.s3.results[0].ok).toBe(false);
      expect(result!.questionsDeleted).toBe(0);
    });

    it('skips S3 deletion when no file keys present', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          partition_key: 'QUESTION_FILE',
          sort_key: 'proj-1#opp-1#qf-1',
          questionFileId: 'qf-1',
          status: 'UPLOADED',
          // no fileKey or textFileKey
        },
      });
      // QueryCommand → no questions
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // DeleteCommand → delete question file
      mockSend.mockResolvedValueOnce({});

      const result = await deleteQuestionFileWithCascade('proj-1', 'opp-1', 'qf-1');

      expect(result!.s3.keysRequested).toHaveLength(0);
      expect(result!.s3.results).toHaveLength(0);
      expect(mockS3Send).not.toHaveBeenCalled();
    });

    it('uses correct SK pattern for question file lookup', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      await deleteQuestionFileWithCascade('proj-abc', 'opp-xyz', 'qf-999');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            TableName: 'test-table',
            Key: expect.objectContaining({
              partition_key: 'QUESTION_FILE',
              sort_key: 'proj-abc#opp-xyz#qf-999',
            }),
          }),
        }),
      );
    });

    it('deduplicates S3 keys when fileKey and textFileKey are the same', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          partition_key: 'QUESTION_FILE',
          sort_key: 'proj-1#opp-1#qf-1',
          questionFileId: 'qf-1',
          fileKey: 'uploads/rfp.pdf',
          textFileKey: 'uploads/rfp.pdf', // same key
          status: 'PROCESSED',
        },
      });
      mockS3Send.mockResolvedValueOnce({});
      // QueryCommand → no questions
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // DeleteCommand → delete question file
      mockSend.mockResolvedValueOnce({});

      const result = await deleteQuestionFileWithCascade('proj-1', 'opp-1', 'qf-1');

      expect(result!.s3.keysRequested).toHaveLength(1);
      expect(mockS3Send).toHaveBeenCalledTimes(1);
    });
  });

  // ─── baseHandler (HTTP layer) ─────────────────────────────────────────────────

  describe('baseHandler', () => {
    const makeEvent = (queryStringParameters: Record<string, string | undefined>): AuthedEvent =>
      ({
        queryStringParameters,
        auth: { userId: 'user-001', orgId: 'org-123', claims: {} },
        requestContext: { http: { sourceIp: '1.2.3.4', userAgent: 'jest' } },
        headers: {},
        body: undefined,
      }) as unknown as AuthedEvent;

    it('returns 200 with deletion result on success', async () => {
      // GetCommand → found
      mockSend.mockResolvedValueOnce({
        Item: {
          partition_key: 'QUESTION_FILE',
          sort_key: 'proj-1#opp-1#qf-1',
          questionFileId: 'qf-1',
          status: 'PROCESSED',
        },
      });
      // QueryCommand → no questions
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // DeleteCommand
      mockSend.mockResolvedValueOnce({});

      const event = makeEvent({ projectId: 'proj-1', oppId: 'opp-1', questionFileId: 'qf-1' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.success).toBe(true);
      expect(body.deleted.questionFileId).toBe('qf-1');
      expect(body.questions.deleted).toBe(0);
    });

    it('returns 400 when projectId is missing', async () => {
      const event = makeEvent({ oppId: 'opp-1', questionFileId: 'qf-1' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('projectId query param is required');
    });

    it('returns 400 when questionFileId is missing', async () => {
      const event = makeEvent({ projectId: 'proj-1', oppId: 'opp-1' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('questionFileId query param is required');
    });

    it('returns 400 when oppId is missing', async () => {
      const event = makeEvent({ projectId: 'proj-1', questionFileId: 'qf-1' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('oppId query param is required');
    });

    it('returns 404 when question file does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const event = makeEvent({ projectId: 'proj-1', oppId: 'opp-1', questionFileId: 'qf-missing' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 404 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('Question file not found');
    });

    it('includes s3 results in response', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          partition_key: 'QUESTION_FILE',
          sort_key: 'proj-1#opp-1#qf-1',
          questionFileId: 'qf-1',
          fileKey: 'uploads/rfp.pdf',
          status: 'PROCESSED',
        },
      });
      mockS3Send.mockResolvedValueOnce({});
      // QueryCommand → no questions
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // DeleteCommand
      mockSend.mockResolvedValueOnce({});

      const event = makeEvent({ projectId: 'proj-1', oppId: 'opp-1', questionFileId: 'qf-1' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.s3.bucket).toBe('test-bucket');
      expect(body.s3.keysRequested).toContain('uploads/rfp.pdf');
    });
  });
});
