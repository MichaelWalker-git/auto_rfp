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

// Mock AWS SDK
const mockSend = jest.fn();
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
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './delete-question';
import { deleteQuestion } from '@/helpers/question';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

describe('delete-question', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  // ─── deleteQuestion helper ────────────────────────────────────────────────────

  describe('deleteQuestion', () => {
    it('returns null when question does not exist', async () => {
      // getItem returns null (no Item)
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await deleteQuestion('proj-1', 'opp-1', 'file-1', 'q-1');

      expect(result).toBeNull();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('deletes question and answer, returns result', async () => {
      // getItem → found
      mockSend.mockResolvedValueOnce({ Item: { partition_key: 'QUESTION', sort_key: 'proj-1#opp-1#file-1#q-1' } });
      // deleteItem (question)
      mockSend.mockResolvedValueOnce({});
      // deleteItem (answer)
      mockSend.mockResolvedValueOnce({});

      const result = await deleteQuestion('proj-1', 'opp-1', 'file-1', 'q-1');

      expect(result).toEqual({
        questionDeleted: true,
        answersDeleted: 1,
        assignmentsDeleted: 0,
        commentsDeleted: 0,
      });
    });

    it('handles missing answer gracefully (answersDeleted = 0)', async () => {
      // getItem → found
      mockSend.mockResolvedValueOnce({ Item: { partition_key: 'QUESTION', sort_key: 'proj-1#opp-1#file-1#q-1' } });
      // deleteItem (question)
      mockSend.mockResolvedValueOnce({});
      // deleteItem (answer) → throws
      mockSend.mockRejectedValueOnce(new Error('ConditionalCheckFailedException'));

      const result = await deleteQuestion('proj-1', 'opp-1', 'file-1', 'q-1');

      expect(result).toEqual({
        questionDeleted: true,
        answersDeleted: 0,
        assignmentsDeleted: 0,
        commentsDeleted: 0,
      });
    });

    it('cascade deletes assignments and comments when orgId is provided', async () => {
      // getItem → found
      mockSend.mockResolvedValueOnce({ Item: { partition_key: 'QUESTION', sort_key: 'proj-1#opp-1#file-1#q-1' } });
      // deleteItem (question)
      mockSend.mockResolvedValueOnce({});
      // deleteItem (answer)
      mockSend.mockResolvedValueOnce({});
      // queryBySkPrefix (assignments) → 2 items
      mockSend.mockResolvedValueOnce({
        Items: [
          { partition_key: 'ASSIGNMENT', sort_key: 'org-1#proj-1#q-1#a1' },
          { partition_key: 'ASSIGNMENT', sort_key: 'org-1#proj-1#q-1#a2' },
        ],
      });
      // deleteItem (assignment 1)
      mockSend.mockResolvedValueOnce({});
      // deleteItem (assignment 2)
      mockSend.mockResolvedValueOnce({});
      // queryBySkPrefix (comments) → 1 item
      mockSend.mockResolvedValueOnce({
        Items: [{ partition_key: 'COMMENT', sort_key: 'org-1#proj-1#QUESTION#q-1#c1' }],
      });
      // deleteItem (comment 1)
      mockSend.mockResolvedValueOnce({});

      const result = await deleteQuestion('proj-1', 'opp-1', 'file-1', 'q-1', 'org-1');

      expect(result).toEqual({
        questionDeleted: true,
        answersDeleted: 1,
        assignmentsDeleted: 2,
        commentsDeleted: 1,
      });
    });

    it('skips cascade delete when orgId is not provided', async () => {
      // getItem → found
      mockSend.mockResolvedValueOnce({ Item: { partition_key: 'QUESTION', sort_key: 'proj-1#opp-1#file-1#q-1' } });
      // deleteItem (question)
      mockSend.mockResolvedValueOnce({});
      // deleteItem (answer)
      mockSend.mockResolvedValueOnce({});

      const result = await deleteQuestion('proj-1', 'opp-1', 'file-1', 'q-1');

      expect(result).toEqual({
        questionDeleted: true,
        answersDeleted: 1,
        assignmentsDeleted: 0,
        commentsDeleted: 0,
      });
      // Only 3 calls: getItem + deleteQuestion + deleteAnswer
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('uses correct SK pattern for question lookup', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      await deleteQuestion('proj-abc', 'opp-xyz', 'file-123', 'q-999');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            TableName: 'test-table',
            Key: expect.objectContaining({
              partition_key: 'QUESTION',
              sort_key: 'proj-abc#opp-xyz#file-123#q-999',
            }),
          }),
        }),
      );
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
      // getItem → found
      mockSend.mockResolvedValueOnce({ Item: { partition_key: 'QUESTION', sort_key: 'proj-1#opp-1##q-1' } });
      // deleteItem (question)
      mockSend.mockResolvedValueOnce({});
      // deleteItem (answer)
      mockSend.mockResolvedValueOnce({});

      const event = makeEvent({ projectId: 'proj-1', opportunityId: 'opp-1', questionId: 'q-1' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.ok).toBe(true);
      expect(body.projectId).toBe('proj-1');
      expect(body.opportunityId).toBe('opp-1');
      expect(body.questionId).toBe('q-1');
      expect(body.questionDeleted).toBe(true);
    });

    it('returns 400 when projectId is missing', async () => {
      const event = makeEvent({ opportunityId: 'opp-1', questionId: 'q-1' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('projectId, opportunityId and questionId are required');
    });

    it('returns 400 when opportunityId is missing', async () => {
      const event = makeEvent({ projectId: 'proj-1', questionId: 'q-1' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('projectId, opportunityId and questionId are required');
    });

    it('returns 400 when questionId is missing', async () => {
      const event = makeEvent({ projectId: 'proj-1', opportunityId: 'opp-1' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('projectId, opportunityId and questionId are required');
    });

    it('returns 404 when question does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const event = makeEvent({ projectId: 'proj-1', opportunityId: 'opp-1', questionId: 'q-missing' });
      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 404 });
      const body = JSON.parse((response as { body: string }).body);
      expect(body.message).toBe('Question not found');
      expect(body.questionId).toBe('q-missing');
    });

    it('passes fileId and orgId to deleteQuestion', async () => {
      // getItem → found
      mockSend.mockResolvedValueOnce({ Item: { partition_key: 'QUESTION', sort_key: 'proj-1#opp-1#file-abc#q-1' } });
      // deleteItem (question)
      mockSend.mockResolvedValueOnce({});
      // deleteItem (answer)
      mockSend.mockResolvedValueOnce({});
      // queryBySkPrefix (assignments) → empty
      mockSend.mockResolvedValueOnce({ Items: [] });
      // queryBySkPrefix (comments) → empty
      mockSend.mockResolvedValueOnce({ Items: [] });

      const event = makeEvent({
        projectId: 'proj-1',
        opportunityId: 'opp-1',
        questionId: 'q-1',
        fileId: 'file-abc',
        orgId: 'org-123',
      });

      const response = await baseHandler(event);

      expect(response).toMatchObject({ statusCode: 200 });
      // Verify the SK used includes fileId
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            Key: expect.objectContaining({
              sort_key: 'proj-1#opp-1#file-abc#q-1',
            }),
          }),
        }),
      );
    });
  });
});
