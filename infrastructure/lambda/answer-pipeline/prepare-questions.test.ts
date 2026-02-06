/**
 * Unit tests for prepare-questions Lambda
 */

jest.mock('../helpers/db', () => ({
  docClient: {
    send: jest.fn(),
  },
}));

jest.mock('../helpers/project', () => ({
  getProjectById: jest.fn(),
}));

jest.mock('../sentry-lambda', () => ({
  withSentryLambda: (fn: any) => fn,
}));

import { baseHandler, PrepareQuestionsEvent } from './prepare-questions';

describe('prepare-questions Lambda', () => {
  const mockContext = {
    functionName: 'test',
    memoryLimitInMB: '128',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test',
    awsRequestId: 'request-123',
    getRemainingTimeInMillis: () => 30000,
  } as any;

  const validEvent: PrepareQuestionsEvent = {
    projectId: 'proj-123',
    questionFileId: 'qf-456',
  };

  const { docClient } = require('../helpers/db');
  const { getProjectById } = require('../helpers/project');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Input Validation', () => {
    it('should throw when projectId is missing', async () => {
      const event = { questionFileId: 'qf-456' } as any;

      await expect(baseHandler(event, mockContext)).rejects.toThrow(
        'projectId is required'
      );
    });

    it('should throw when projectId is empty string', async () => {
      const event: PrepareQuestionsEvent = { projectId: '', questionFileId: 'qf-456' };

      await expect(baseHandler(event, mockContext)).rejects.toThrow(
        'projectId is required'
      );
    });
  });

  describe('Project Validation', () => {
    it('should throw when project is not found', async () => {
      getProjectById.mockResolvedValueOnce(null);

      await expect(baseHandler(validEvent, mockContext)).rejects.toThrow(
        'Project not found: proj-123'
      );
    });

    it('should throw when project has no orgId', async () => {
      getProjectById.mockResolvedValueOnce({ id: 'proj-123', name: 'Test Project' });

      await expect(baseHandler(validEvent, mockContext)).rejects.toThrow(
        'Project proj-123 has no orgId'
      );
    });
  });

  describe('Question Retrieval', () => {
    beforeEach(() => {
      getProjectById.mockResolvedValue({ id: 'proj-123', orgId: 'org-789' });
    });

    it('should return empty array when no questions exist', async () => {
      docClient.send.mockResolvedValueOnce({ Items: [] });

      const result = await baseHandler(validEvent, mockContext);

      expect(result).toEqual({
        questions: [],
        totalCount: 0,
        projectId: 'proj-123',
        orgId: 'org-789',
      });
    });

    it('should return all questions for a project', async () => {
      docClient.send.mockResolvedValueOnce({
        Items: [
          { questionId: 'q-1', question: 'Question 1', questionFileId: 'qf-456' },
          { questionId: 'q-2', question: 'Question 2', questionFileId: 'qf-456' },
        ],
      });

      const result = await baseHandler(validEvent, mockContext);

      expect(result.totalCount).toBe(2);
      expect(result.questions).toHaveLength(2);
      
      const firstQuestion = result.questions[0];
      expect(firstQuestion).toBeDefined();
      expect(firstQuestion?.questionId).toBe('q-1');
      expect(firstQuestion?.projectId).toBe('proj-123');
      expect(firstQuestion?.orgId).toBe('org-789');
      expect(firstQuestion?.questionText).toBe('Question 1');
    });

    it('should filter questions by questionFileId when provided', async () => {
      docClient.send.mockResolvedValueOnce({
        Items: [
          { questionId: 'q-1', question: 'Question 1', questionFileId: 'qf-456' },
          { questionId: 'q-2', question: 'Question 2', questionFileId: 'qf-other' },
          { questionId: 'q-3', question: 'Question 3', questionFileId: 'qf-456' },
        ],
      });

      const result = await baseHandler(validEvent, mockContext);

      expect(result.totalCount).toBe(2);
      expect(result.questions.map((q) => q.questionId)).toEqual(['q-1', 'q-3']);
    });

    it('should return all questions when questionFileId is not provided', async () => {
      docClient.send.mockResolvedValueOnce({
        Items: [
          { questionId: 'q-1', question: 'Question 1', questionFileId: 'qf-456' },
          { questionId: 'q-2', question: 'Question 2', questionFileId: 'qf-other' },
        ],
      });

      const event: PrepareQuestionsEvent = { projectId: 'proj-123' };
      const result = await baseHandler(event, mockContext);

      expect(result.totalCount).toBe(2);
    });

    it('should skip items without questionId or question text', async () => {
      docClient.send.mockResolvedValueOnce({
        Items: [
          { questionId: 'q-1', question: 'Question 1', questionFileId: 'qf-456' },
          { questionId: null, question: 'Missing ID', questionFileId: 'qf-456' },
          { questionId: 'q-3', question: null, questionFileId: 'qf-456' },
          { questionId: 'q-4', question: '', questionFileId: 'qf-456' },
        ],
      });

      const result = await baseHandler(validEvent, mockContext);

      expect(result.totalCount).toBe(1);
      expect(result.questions).toHaveLength(1);
      
      const onlyQuestion = result.questions[0];
      expect(onlyQuestion).toBeDefined();
      expect(onlyQuestion?.questionId).toBe('q-1');
    });

    it('should handle pagination with LastEvaluatedKey', async () => {
      // First page
      docClient.send
        .mockResolvedValueOnce({
          Items: [
            { questionId: 'q-1', question: 'Question 1', questionFileId: 'qf-456' },
          ],
          LastEvaluatedKey: { pk: 'QUESTION', sk: 'proj-123#q-1' },
        })
        // Second page
        .mockResolvedValueOnce({
          Items: [
            { questionId: 'q-2', question: 'Question 2', questionFileId: 'qf-456' },
          ],
        });

      const result = await baseHandler(validEvent, mockContext);

      expect(result.totalCount).toBe(2);
      expect(docClient.send).toHaveBeenCalledTimes(2);
    });
  });
});