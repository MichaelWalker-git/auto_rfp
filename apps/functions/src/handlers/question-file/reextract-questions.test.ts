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

import { baseHandler } from './reextract-questions';
import { reextractQuestions } from '@/helpers/questionFile';
import type { ReextractQuestions } from '@auto-rfp/core';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

describe('reextract-questions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  // ─── reextractQuestions helper ────────────────────────────────────────────────

  describe('reextractQuestions', () => {
    it('returns null when question file does not exist', async () => {
      // getQuestionFileItem → not found
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await reextractQuestions({
        projectId: 'proj-1',
        oppId: 'opp-1',
        questionFileId: 'qf-1',
      });

      expect(result).toBeNull();
    });

    it('deletes questions, resets status, starts pipeline, and returns result', async () => {
      // getQuestionFileItem → found
      mockSend.mockResolvedValueOnce({
        Item: {
          partition_key: 'QUESTION_FILE',
          sort_key: 'proj-1#opp-1#qf-1',
          questionFileId: 'qf-1',
          fileKey: 'uploads/rfp.pdf',
          mimeType: 'application/pdf',
          status: 'PROCESSED',
        },
      });
      // queryAllBySkPrefix (questions) → 2 questions
      mockSend.mockResolvedValueOnce({
        Items: [
          { partition_key: 'QUESTION', sort_key: 'proj-1#opp-1#qf-1#q1', questionId: 'q1' },
          { partition_key: 'QUESTION', sort_key: 'proj-1#opp-1#qf-1#q2', questionId: 'q2' },
        ],
        LastEvaluatedKey: undefined,
      });
      // deleteItem (answer q1) — success
      mockSend.mockResolvedValueOnce({});
      // deleteItem (question q1)
      mockSend.mockResolvedValueOnce({});
      // deleteItem (answer q2) — success
      mockSend.mockResolvedValueOnce({});
      // deleteItem (question q2)
      mockSend.mockResolvedValueOnce({});
      // updateQuestionFile (reset to UPLOADED)
      mockSend.mockResolvedValueOnce({});
      // startPipeline (SFN) — mocked at module level
      // updateQuestionFile (set to PROCESSING)
      mockSend.mockResolvedValueOnce({});

      const result = await reextractQuestions({
        projectId: 'proj-1',
        oppId: 'opp-1',
        questionFileId: 'qf-1',
      });

      expect(result).not.toBeNull();
      expect(result!.deletedCount).toBe(2);
      expect(result!.executionArn).toBe('arn:test');
    });

    it('handles zero questions gracefully', async () => {
      // getQuestionFileItem → found
      mockSend.mockResolvedValueOnce({
        Item: {
          partition_key: 'QUESTION_FILE',
          sort_key: 'proj-1#opp-1#qf-1',
          questionFileId: 'qf-1',
          status: 'FAILED',
        },
      });
      // queryAllBySkPrefix → no questions
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // updateQuestionFile (reset to UPLOADED)
      mockSend.mockResolvedValueOnce({});
      // updateQuestionFile (set to PROCESSING)
      mockSend.mockResolvedValueOnce({});

      const result = await reextractQuestions({
        projectId: 'proj-1',
        oppId: 'opp-1',
        questionFileId: 'qf-1',
      });

      expect(result!.deletedCount).toBe(0);
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
      // getQuestionFileItem → found
      mockSend.mockResolvedValueOnce({
        Item: {
          partition_key: 'QUESTION_FILE',
          sort_key: 'proj-1#opp-1#qf-1',
          questionFileId: 'qf-1',
          status: 'PROCESSED',
        },
      });
      // queryAllBySkPrefix → no questions
      mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
      // updateQuestionFile (reset)
      mockSend.mockResolvedValueOnce({});
      // updateQuestionFile (processing)
      mockSend.mockResolvedValueOnce({});

      const event = makeEvent({ projectId: 'proj-1', oppId: 'opp-1', questionFileId: 'qf-1' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 202 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.ok).toBe(true);
      expect(body.deletedCount).toBe(0);
    });

    it('returns 400 when body is missing', async () => {
      const event = { ...makeEvent({}), body: undefined } as unknown as AuthedEvent;
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('Request body is required');
    });

    it('returns 400 with issues when projectId is missing', async () => {
      const event = makeEvent({ oppId: 'opp-1', questionFileId: 'qf-1' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('Validation failed');
      expect(body.issues).toBeDefined();
    });

    it('returns 400 when oppId is missing', async () => {
      const event = makeEvent({ projectId: 'proj-1', questionFileId: 'qf-1' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
    });

    it('returns 400 when questionFileId is missing', async () => {
      const event = makeEvent({ projectId: 'proj-1', oppId: 'opp-1' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
    });

    it('returns 404 when question file does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const event = makeEvent({ projectId: 'proj-1', oppId: 'opp-1', questionFileId: 'qf-missing' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 404 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('Question file not found');
    });
  });
});
