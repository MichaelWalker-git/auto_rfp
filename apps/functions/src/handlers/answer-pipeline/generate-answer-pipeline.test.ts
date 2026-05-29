/**
 * Unit tests for generate-answer-pipeline Lambda
 */

jest.mock('@/handlers/answer/generate-answer', () => ({
  generateAnswerForQuestion: jest.fn(),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: any) => fn,
}));

import { baseHandler, GenerateAnswerPipelineEvent } from './generate-answer-pipeline';

describe('generate-answer-pipeline Lambda', () => {
  const mockContext = {
    functionName: 'test',
    memoryLimitInMB: '128',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test',
    awsRequestId: 'request-123',
    getRemainingTimeInMillis: () => 30000,
  } as any;

  const validEvent: GenerateAnswerPipelineEvent = {
    questionId: 'q-123',
    projectId: 'proj-456',
    orgId: 'org-789',
    questionText: 'What is the deadline?',
  };

  const { generateAnswerForQuestion } = require('@/handlers/answer/generate-answer');

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Input Validation', () => {
    it('should return error when questionId is missing', async () => {
      const event = { projectId: 'proj-456', orgId: 'org-789' } as any;

      const result = await baseHandler(event, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required fields');
      expect(result.questionId).toBe('unknown');
    });

    it('should return error when questionId is empty string', async () => {
      const event: GenerateAnswerPipelineEvent = {
        questionId: '',
        projectId: 'proj-456',
        orgId: 'org-789',
      };

      const result = await baseHandler(event, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required fields');
    });

    it('should return error when projectId is missing', async () => {
      const event = { questionId: 'q-123', orgId: 'org-789' } as any;

      const result = await baseHandler(event, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required fields');
      expect(result.questionId).toBe('q-123');
    });

    it('should return error when projectId is empty string', async () => {
      const event: GenerateAnswerPipelineEvent = {
        questionId: 'q-123',
        projectId: '',
        orgId: 'org-789',
      };

      const result = await baseHandler(event, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required fields');
    });

    it('should return error when orgId is missing', async () => {
      const event = { questionId: 'q-123', projectId: 'proj-456' } as any;

      const result = await baseHandler(event, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required fields');
    });

    it('should return error when orgId is empty string', async () => {
      const event: GenerateAnswerPipelineEvent = {
        questionId: 'q-123',
        projectId: 'proj-456',
        orgId: '',
      };

      const result = await baseHandler(event, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required fields');
    });

    it('should return error when all required fields are missing', async () => {
      const event = {} as any;

      const result = await baseHandler(event, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required fields');
      expect(result.questionId).toBe('unknown');
    });

    it('should return error when all required fields are empty strings', async () => {
      const event: GenerateAnswerPipelineEvent = {
        questionId: '',
        projectId: '',
        orgId: '',
      };

      const result = await baseHandler(event, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required fields');
    });
  });

  describe('Successful Answer Generation', () => {
    it('should return success with answer data', async () => {
      generateAnswerForQuestion.mockResolvedValueOnce({
        questionId: 'q-123',
        answer: 'The deadline is March 15, 2026.',
        confidence: 0.95,
        found: true,
        fromContentLibrary: false,
      });

      const result = await baseHandler(validEvent, mockContext);

      expect(result.success).toBe(true);
      expect(result.questionId).toBe('q-123');
      expect(result.answer).toBe('The deadline is March 15, 2026.');
      expect(result.confidence).toBe(0.95);
      expect(result.found).toBe(true);
      expect(result.fromContentLibrary).toBe(false);
      expect(result.error).toBeUndefined();
    });

    it('should return success with content library match', async () => {
      generateAnswerForQuestion.mockResolvedValueOnce({
        questionId: 'q-123',
        answer: 'Standard response from library.',
        confidence: 0.92,
        found: true,
        fromContentLibrary: true,
      });

      const result = await baseHandler(validEvent, mockContext);

      expect(result.success).toBe(true);
      expect(result.fromContentLibrary).toBe(true);
    });

    it('should return success even when answer not found in context', async () => {
      generateAnswerForQuestion.mockResolvedValueOnce({
        questionId: 'q-123',
        answer: 'General best practice response.',
        confidence: 0.35,
        found: false,
        fromContentLibrary: false,
      });

      const result = await baseHandler(validEvent, mockContext);

      expect(result.success).toBe(true);
      expect(result.found).toBe(false);
      expect(result.confidence).toBe(0.35);
    });

    it('should pass questionText when provided', async () => {
      generateAnswerForQuestion.mockResolvedValueOnce({
        questionId: 'q-123',
        answer: 'Test answer',
        confidence: 0.8,
        found: true,
      });

      await baseHandler(validEvent, mockContext);

      expect(generateAnswerForQuestion).toHaveBeenCalledWith({
        questionId: 'q-123',
        projectId: 'proj-456',
        orgId: 'org-789',
        questionText: 'What is the deadline?',
      });
    });

    it('should work without questionText', async () => {
      generateAnswerForQuestion.mockResolvedValueOnce({
        questionId: 'q-123',
        answer: 'Test answer',
        confidence: 0.8,
        found: true,
      });

      const eventWithoutText: GenerateAnswerPipelineEvent = {
        questionId: 'q-123',
        projectId: 'proj-456',
        orgId: 'org-789',
      };

      await baseHandler(eventWithoutText, mockContext);

      expect(generateAnswerForQuestion).toHaveBeenCalledWith({
        questionId: 'q-123',
        projectId: 'proj-456',
        orgId: 'org-789',
        questionText: undefined,
      });
    });
  });

  describe('Error Handling', () => {
    it('should return success=false when generateAnswerForQuestion throws Error', async () => {
      generateAnswerForQuestion.mockRejectedValueOnce(new Error('Bedrock rate limit exceeded'));

      const result = await baseHandler(validEvent, mockContext);

      expect(result.success).toBe(false);
      expect(result.questionId).toBe('q-123');
      expect(result.error).toBe('Bedrock rate limit exceeded');
      expect(result.answer).toBeUndefined();
    });

    it('should return success=false when generateAnswerForQuestion throws non-Error', async () => {
      generateAnswerForQuestion.mockRejectedValueOnce('String error');

      const result = await baseHandler(validEvent, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unknown error');
    });

    it('should return success=false when Pinecone fails', async () => {
      generateAnswerForQuestion.mockRejectedValueOnce(new Error('PINECONE_API_KEY not set'));

      const result = await baseHandler(validEvent, mockContext);

      expect(result.success).toBe(false);
      expect(result.error).toBe('PINECONE_API_KEY not set');
    });

    it('should not throw - always returns a result object', async () => {
      generateAnswerForQuestion.mockRejectedValueOnce(new Error('Critical failure'));

      // Should not throw
      const result = await baseHandler(validEvent, mockContext);

      expect(result).toBeDefined();
      expect(result.success).toBe(false);
    });
  });
});