/**
 * Tests for textract-callback helper.
 * These tests ensure the pagination bug fix is properly covered.
 */

// Mock AWS SDK before imports
const mockSend = jest.fn();
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

const mockSfnSend = jest.fn();
jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({ send: mockSfnSend })),
  SendTaskSuccessCommand: jest.fn((params) => ({ type: 'SendTaskSuccess', params })),
  SendTaskFailureCommand: jest.fn((params) => ({ type: 'SendTaskFailure', params })),
  TaskTimedOut: class TaskTimedOut extends Error {
    name = 'TaskTimedOut';
  },
  TaskDoesNotExist: class TaskDoesNotExist extends Error {
    name = 'TaskDoesNotExist';
  },
}));

jest.mock('@/helpers/audit-log', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/helpers/secret', () => ({
  getHmacSecret: jest.fn().mockResolvedValue('mock-secret'),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import {
  parseJobTag,
  findQuestionFileById,
  processTextractCallback,
  isTaskTokenExpiredError,
  TextractMessage,
} from './textract-callback';

describe('textract-callback helper', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockSfnSend.mockReset();
  });

  // ─── parseJobTag tests ─────────────────────────────────────────────────────

  describe('parseJobTag', () => {
    it('parses valid UUID JobTag', () => {
      const jobTag = '7e290de5-cb70-4eb0-92f7-5b657b5d2afb';
      const result = parseJobTag(jobTag);
      
      expect(result).not.toBeNull();
      expect(result!.questionFileId).toBe(jobTag);
    });

    it('parses uppercase UUID JobTag', () => {
      const jobTag = '7E290DE5-CB70-4EB0-92F7-5B657B5D2AFB';
      const result = parseJobTag(jobTag);
      
      expect(result).not.toBeNull();
      expect(result!.questionFileId).toBe(jobTag);
    });

    it('returns null for invalid UUID format', () => {
      const invalidJobTags = [
        'not-a-uuid',
        '7e290de5-cb70-4eb0-92f7', // incomplete
        '7e290de5cb704eb092f75b657b5d2afb', // no dashes
        '', // empty
        'projectId:oppId:questionFileId', // old format with colons
        'projectId#oppId#questionFileId', // old format with hashes
      ];

      for (const jobTag of invalidJobTags) {
        const result = parseJobTag(jobTag);
        expect(result).toBeNull();
      }
    });
  });

  // ─── findQuestionFileById tests (PAGINATION BUG FIX) ─────────────────────────

  describe('findQuestionFileById', () => {
    const questionFileId = '7e290de5-cb70-4eb0-92f7-5b657b5d2afb';
    const targetSK = `proj-123#opp-456#${questionFileId}`;

    it('finds question file in first page', async () => {
      const targetItem = {
        partition_key: 'QUESTION_FILE',
        sort_key: targetSK,
        questionFileId,
        taskToken: 'token-123',
        orgId: 'org-1',
      };

      mockSend.mockResolvedValueOnce({
        Items: [targetItem],
        LastEvaluatedKey: undefined,
      });

      const result = await findQuestionFileById(questionFileId);

      expect(result).not.toBeNull();
      expect(result!.item.questionFileId).toBe(questionFileId);
      expect(result!.sk).toBe(targetSK);
      expect(result!.projectId).toBe('proj-123');
      expect(result!.oppId).toBe('opp-456');
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('PAGINATION: finds question file in SECOND page (regression test for bug)', async () => {
      // This test ensures the pagination bug is fixed.
      // The bug was: DynamoDB Query only returns up to 1MB per call,
      // but the old code didn't paginate, so items beyond 1MB were never found.

      const otherItems = Array.from({ length: 100 }, (_, i) => ({
        partition_key: 'QUESTION_FILE',
        sort_key: `proj-other#opp-other#other-file-${i}`,
        questionFileId: `other-file-${i}`,
      }));

      const targetItem = {
        partition_key: 'QUESTION_FILE',
        sort_key: targetSK,
        questionFileId,
        taskToken: 'token-123',
        orgId: 'org-1',
      };

      // First page: 100 other items, with LastEvaluatedKey indicating more pages
      mockSend.mockResolvedValueOnce({
        Items: otherItems,
        LastEvaluatedKey: { partition_key: 'QUESTION_FILE', sort_key: 'last-key' },
      });

      // Second page: contains our target item
      mockSend.mockResolvedValueOnce({
        Items: [targetItem],
        LastEvaluatedKey: undefined,
      });

      const result = await findQuestionFileById(questionFileId);

      expect(result).not.toBeNull();
      expect(result!.item.questionFileId).toBe(questionFileId);
      expect(result!.sk).toBe(targetSK);
      // Verify pagination was used - 2 Query calls
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('PAGINATION: finds question file in THIRD page', async () => {
      const page1Items = Array.from({ length: 50 }, (_, i) => ({
        partition_key: 'QUESTION_FILE',
        sort_key: `proj-1#opp-1#file-${i}`,
        questionFileId: `file-${i}`,
      }));

      const page2Items = Array.from({ length: 50 }, (_, i) => ({
        partition_key: 'QUESTION_FILE',
        sort_key: `proj-2#opp-2#file-${i + 50}`,
        questionFileId: `file-${i + 50}`,
      }));

      const targetItem = {
        partition_key: 'QUESTION_FILE',
        sort_key: targetSK,
        questionFileId,
        taskToken: 'token-123',
        orgId: 'org-1',
      };

      mockSend
        .mockResolvedValueOnce({
          Items: page1Items,
          LastEvaluatedKey: { pk: 'QUESTION_FILE', sk: 'key-1' },
        })
        .mockResolvedValueOnce({
          Items: page2Items,
          LastEvaluatedKey: { pk: 'QUESTION_FILE', sk: 'key-2' },
        })
        .mockResolvedValueOnce({
          Items: [targetItem],
          LastEvaluatedKey: undefined,
        });

      const result = await findQuestionFileById(questionFileId);

      expect(result).not.toBeNull();
      expect(result!.item.questionFileId).toBe(questionFileId);
      expect(mockSend).toHaveBeenCalledTimes(3);
    });

    it('returns null when question file not found after all pages', async () => {
      const page1Items = Array.from({ length: 25 }, (_, i) => ({
        partition_key: 'QUESTION_FILE',
        sort_key: `proj-1#opp-1#other-${i}`,
        questionFileId: `other-${i}`,
      }));

      mockSend
        .mockResolvedValueOnce({
          Items: page1Items,
          LastEvaluatedKey: { pk: 'QUESTION_FILE', sk: 'key-1' },
        })
        .mockResolvedValueOnce({
          Items: [],
          LastEvaluatedKey: undefined,
        });

      const result = await findQuestionFileById(questionFileId);

      expect(result).toBeNull();
      expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('returns null when no items exist', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

      const result = await findQuestionFileById(questionFileId);

      expect(result).toBeNull();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  // ─── isTaskTokenExpiredError tests ─────────────────────────────────────────

  describe('isTaskTokenExpiredError', () => {
    it('returns true for TaskTimedOut error', () => {
      const { TaskTimedOut } = jest.requireMock('@aws-sdk/client-sfn');
      const err = new TaskTimedOut('Task timed out');
      
      expect(isTaskTokenExpiredError(err)).toBe(true);
    });

    it('returns true for TaskDoesNotExist error', () => {
      const { TaskDoesNotExist } = jest.requireMock('@aws-sdk/client-sfn');
      const err = new TaskDoesNotExist('Task does not exist');
      
      expect(isTaskTokenExpiredError(err)).toBe(true);
    });

    it('returns true for error with TaskTimedOut name', () => {
      const err = { name: 'TaskTimedOut', message: 'timeout' };
      
      expect(isTaskTokenExpiredError(err)).toBe(true);
    });

    it('returns false for other errors', () => {
      const err = new Error('Some other error');
      
      expect(isTaskTokenExpiredError(err)).toBe(false);
    });
  });

  // ─── processTextractCallback tests ─────────────────────────────────────────

  describe('processTextractCallback', () => {
    const questionFileId = '7e290de5-cb70-4eb0-92f7-5b657b5d2afb';
    const targetSK = `proj-123#opp-456#${questionFileId}`;
    const jobId = 'textract-job-123';

    const validMessage: TextractMessage = {
      JobId: jobId,
      Status: 'SUCCEEDED',
      JobTag: questionFileId,
    };

    const targetItem = {
      partition_key: 'QUESTION_FILE',
      sort_key: targetSK,
      questionFileId,
      taskToken: 'task-token-abc',
      orgId: 'org-1',
    };

    it('processes SUCCEEDED status and sends task success', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [targetItem],
        LastEvaluatedKey: undefined,
      });
      mockSfnSend.mockResolvedValueOnce({});

      const result = await processTextractCallback(validMessage);

      expect(result.success).toBe(true);
      expect(result.questionFileId).toBe(questionFileId);
      expect(result.status).toBe('SUCCEEDED');
      expect(mockSfnSend).toHaveBeenCalledTimes(1);
      expect(mockSfnSend.mock.calls[0][0].type).toBe('SendTaskSuccess');
    });

    it('processes FAILED status and sends task failure', async () => {
      const failedMessage: TextractMessage = {
        ...validMessage,
        Status: 'FAILED',
      };

      mockSend.mockResolvedValueOnce({
        Items: [targetItem],
        LastEvaluatedKey: undefined,
      });
      mockSfnSend.mockResolvedValueOnce({});

      const result = await processTextractCallback(failedMessage);

      expect(result.success).toBe(true);
      expect(result.status).toBe('FAILED');
      expect(mockSfnSend).toHaveBeenCalledTimes(1);
      expect(mockSfnSend.mock.calls[0][0].type).toBe('SendTaskFailure');
    });

    it('returns error when JobTag is missing', async () => {
      const noTagMessage: TextractMessage = {
        JobId: jobId,
        Status: 'SUCCEEDED',
      };

      const result = await processTextractCallback(noTagMessage);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Missing JobTag');
    });

    it('returns error when JobTag is invalid', async () => {
      const invalidTagMessage: TextractMessage = {
        JobId: jobId,
        Status: 'SUCCEEDED',
        JobTag: 'not-a-uuid',
      };

      const result = await processTextractCallback(invalidTagMessage);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid JobTag format');
    });

    it('returns error when question file not found', async () => {
      mockSend.mockResolvedValueOnce({
        Items: [],
        LastEvaluatedKey: undefined,
      });

      const result = await processTextractCallback(validMessage);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Question file not found');
    });

    it('returns error when taskToken is missing', async () => {
      const itemWithoutToken = { ...targetItem, taskToken: undefined };
      
      mockSend.mockResolvedValueOnce({
        Items: [itemWithoutToken],
        LastEvaluatedKey: undefined,
      });

      const result = await processTextractCallback(validMessage);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No taskToken');
    });

    it('handles task token expired error gracefully', async () => {
      const { TaskTimedOut } = jest.requireMock('@aws-sdk/client-sfn');
      
      mockSend.mockResolvedValueOnce({
        Items: [targetItem],
        LastEvaluatedKey: undefined,
      });
      mockSfnSend.mockRejectedValueOnce(new TaskTimedOut('Task timed out'));
      mockSend.mockResolvedValueOnce({}); // For markQuestionFileAsExpired UpdateCommand

      const result = await processTextractCallback(validMessage);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Task token expired');
      // Verify UpdateCommand was called to mark as expired
      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });
});
