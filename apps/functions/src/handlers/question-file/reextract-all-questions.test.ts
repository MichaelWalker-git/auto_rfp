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

// Mock Step Functions
jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({ send: jest.fn().mockResolvedValue({ executionArn: 'arn:test', startDate: new Date('2024-01-01') }) })),
  StartExecutionCommand: jest.fn((params) => ({ type: 'StartExecution', params })),
}));

// Mock S3
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn().mockResolvedValue({}) })),
  DeleteObjectCommand: jest.fn((params) => ({ type: 'DeleteObject', params })),
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
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
  BatchWriteCommand: jest.fn((params) => ({ type: 'BatchWrite', params })),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.QUESTION_PIPELINE_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789:stateMachine:test';

import { baseHandler } from './reextract-all-questions';
import { reextractAllQuestions } from '@/helpers/questionFile';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

describe('reextract-all-questions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  // ─── reextractAllQuestions helper ─────────────────────────────────────────────

  describe('reextractAllQuestions', () => {
    it('returns zero counts when no question files exist', async () => {
      // listQuestionFilesByOpportunity → no files
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // queryAllBySkPrefix (questions) → none
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // queryAllBySkPrefix (answers) → none
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // queryAllBySkPrefix (clusters) → none
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const result = await reextractAllQuestions({
        projectId: 'proj-1',
        oppId: 'opp-1',
      });

      expect(result.questionsDeleted).toBe(0);
      expect(result.answersDeleted).toBe(0);
      expect(result.clustersDeleted).toBe(0);
      expect(result.filesProcessed).toBe(0);
      expect(result.pipelinesStarted).toEqual([]);
    });

    it('deletes questions, answers, clusters and restarts pipelines for all files', async () => {
      // listQuestionFilesByOpportunity → 2 files
      mockSend.mockResolvedValueOnce({
        Items: [
          { questionFileId: 'qf-1', status: 'PROCESSED', fileKey: 'uploads/file1.pdf', mimeType: 'application/pdf' },
          { questionFileId: 'qf-2', status: 'PROCESSED', fileKey: 'uploads/file2.pdf', mimeType: 'application/pdf' },
        ],
        LastEvaluatedKey: undefined,
      });
      // queryAllBySkPrefix (questions) → 3 questions
      mockSend.mockResolvedValueOnce({
        Items: [
          { partition_key: 'QUESTION', sort_key: 'proj-1#opp-1#qf-1#q1' },
          { partition_key: 'QUESTION', sort_key: 'proj-1#opp-1#qf-1#q2' },
          { partition_key: 'QUESTION', sort_key: 'proj-1#opp-1#qf-2#q3' },
        ],
        LastEvaluatedKey: undefined,
      });
      // batchDeleteDynamoItems (questions) → success
      mockSend.mockResolvedValueOnce({});
      // queryAllBySkPrefix (answers) → 2 answers
      mockSend.mockResolvedValueOnce({
        Items: [
          { partition_key: 'ANSWER', sort_key: 'proj-1#opp-1#qf-1#q1' },
          { partition_key: 'ANSWER', sort_key: 'proj-1#opp-1#qf-2#q3' },
        ],
        LastEvaluatedKey: undefined,
      });
      // batchDeleteDynamoItems (answers) → success
      mockSend.mockResolvedValueOnce({});
      // queryAllBySkPrefix (clusters) → 1 cluster matching oppId
      mockSend.mockResolvedValueOnce({
        Items: [
          { partition_key: 'QUESTION_CLUSTER', sort_key: 'proj-1#cluster-1', opportunityId: 'opp-1' },
        ],
        LastEvaluatedKey: undefined,
      });
      // batchDeleteDynamoItems (clusters) → success
      mockSend.mockResolvedValueOnce({});
      // updateQuestionFile (reset qf-1 to UPLOADED)
      mockSend.mockResolvedValueOnce({});
      // startPipeline (SFN) — mocked at module level
      // updateQuestionFile (set qf-1 to PROCESSING)
      mockSend.mockResolvedValueOnce({});
      // updateQuestionFile (reset qf-2 to UPLOADED)
      mockSend.mockResolvedValueOnce({});
      // updateQuestionFile (set qf-2 to PROCESSING)
      mockSend.mockResolvedValueOnce({});

      const result = await reextractAllQuestions({
        projectId: 'proj-1',
        oppId: 'opp-1',
      });

      expect(result.questionsDeleted).toBe(3);
      expect(result.answersDeleted).toBe(2);
      expect(result.clustersDeleted).toBe(1);
      expect(result.filesProcessed).toBe(2);
      expect(result.pipelinesStarted).toHaveLength(2);
      expect(result.pipelinesStarted[0]?.questionFileId).toBe('qf-1');
      expect(result.pipelinesStarted[0]?.executionArn).toBe('arn:test');
      expect(result.pipelinesStarted[1]?.questionFileId).toBe('qf-2');
    });

    it('filters out DELETED and CANCELLED files', async () => {
      // listQuestionFilesByOpportunity → 3 files, 1 deleted, 1 cancelled
      mockSend.mockResolvedValueOnce({
        Items: [
          { questionFileId: 'qf-1', status: 'PROCESSED', fileKey: 'uploads/file1.pdf', mimeType: 'application/pdf' },
          { questionFileId: 'qf-2', status: 'DELETED', fileKey: 'uploads/file2.pdf', mimeType: 'application/pdf' },
          { questionFileId: 'qf-3', status: 'CANCELLED', fileKey: 'uploads/file3.pdf', mimeType: 'application/pdf' },
        ],
        LastEvaluatedKey: undefined,
      });
      // queryAllBySkPrefix (questions) → none
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // queryAllBySkPrefix (answers) → none
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // queryAllBySkPrefix (clusters) → none
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // updateQuestionFile (reset qf-1 to UPLOADED)
      mockSend.mockResolvedValueOnce({});
      // updateQuestionFile (set qf-1 to PROCESSING)
      mockSend.mockResolvedValueOnce({});

      const result = await reextractAllQuestions({
        projectId: 'proj-1',
        oppId: 'opp-1',
      });

      expect(result.filesProcessed).toBe(1);
      expect(result.pipelinesStarted).toHaveLength(1);
      expect(result.pipelinesStarted[0]?.questionFileId).toBe('qf-1');
    });

    it('only deletes clusters matching the opportunityId', async () => {
      // listQuestionFilesByOpportunity → no files
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // queryAllBySkPrefix (questions) → none
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // queryAllBySkPrefix (answers) → none
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // queryAllBySkPrefix (clusters) → 2 clusters, only 1 matches oppId
      mockSend.mockResolvedValueOnce({
        Items: [
          { partition_key: 'QUESTION_CLUSTER', sort_key: 'proj-1#cluster-1', opportunityId: 'opp-1' },
          { partition_key: 'QUESTION_CLUSTER', sort_key: 'proj-1#cluster-2', opportunityId: 'opp-other' },
        ],
        LastEvaluatedKey: undefined,
      });
      // batchDeleteDynamoItems (1 cluster) → success
      mockSend.mockResolvedValueOnce({});

      const result = await reextractAllQuestions({
        projectId: 'proj-1',
        oppId: 'opp-1',
      });

      expect(result.clustersDeleted).toBe(1);
    });
  });

  // ─── baseHandler (HTTP layer) ─────────────────────────────────────────────────

  describe('baseHandler', () => {
    const makeEvent = (body: unknown): AuthedEvent =>
      ({
        body: JSON.stringify(body),
        auth: { userId: 'user-001', orgId: 'org-123', claims: {} },
        requestContext: { http: { sourceIp: '1.2.3.4', userAgent: 'jest' } },
        headers: {},
        queryStringParameters: {},
      }) as unknown as AuthedEvent;

    it('returns 202 with result on valid input', async () => {
      // listQuestionFilesByOpportunity → no files
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // queryAllBySkPrefix (questions) → none
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // queryAllBySkPrefix (answers) → none
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // queryAllBySkPrefix (clusters) → none
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

      const event = makeEvent({ projectId: 'proj-1', oppId: 'opp-1' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 202 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.ok).toBe(true);
      expect(body.questionsDeleted).toBe(0);
      expect(body.answersDeleted).toBe(0);
      expect(body.clustersDeleted).toBe(0);
      expect(body.filesProcessed).toBe(0);
    });

    it('returns 400 when body is missing', async () => {
      const event = { ...makeEvent({}), body: undefined } as unknown as AuthedEvent;
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('Request body is required');
    });

    it('returns 400 with issues when projectId is missing', async () => {
      const event = makeEvent({ oppId: 'opp-1' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('Validation failed');
      expect(body.issues).toBeDefined();
    });

    it('returns 400 when oppId is missing', async () => {
      const event = makeEvent({ projectId: 'proj-1' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('Validation failed');
    });
  });
});
