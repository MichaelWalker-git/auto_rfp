import { baseHandler } from './mark-question-file-failed';
import { AiNotConfiguredError } from '@/helpers/ai-config-error';

jest.mock('@/helpers/questionFile', () => ({
  updateQuestionFile: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

const { updateQuestionFile } = require('@/helpers/questionFile');

const mockContext = {
  functionName: 'test',
  awsRequestId: 'request-123',
  getRemainingTimeInMillis: () => 30000,
} as never;

const validEvent = {
  questionFileId: 'qf-123',
  projectId: 'proj-456',
  opportunityId: 'opp-789',
};

describe('mark-question-file-failed Lambda', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('input validation', () => {
    it.each(['questionFileId', 'projectId', 'opportunityId'] as const)(
      'throws when %s is missing',
      async (missing) => {
        const event = { ...validEvent, [missing]: undefined };
        await expect(baseHandler(event, mockContext)).rejects.toThrow(
          'projectId, opportunityId and questionFileId are required',
        );
        expect(updateQuestionFile).not.toHaveBeenCalled();
      },
    );
  });

  describe('marks the file FAILED', () => {
    it('writes FAILED with the correct identifiers', async () => {
      const result = await baseHandler(validEvent, mockContext);

      expect(updateQuestionFile).toHaveBeenCalledWith(
        'proj-456',
        'opp-789',
        'qf-123',
        expect.objectContaining({ status: 'FAILED' }),
      );
      expect(result).toEqual({ questionFileId: 'qf-123', projectId: 'proj-456', oppId: 'opp-789' });
    });

    it('renders the friendly AI-not-configured message when the cause is AiNotConfiguredError', async () => {
      const cause = JSON.stringify({
        errorType: 'AiNotConfiguredError',
        errorMessage: new AiNotConfiguredError('org-1').message,
      });

      await baseHandler({ ...validEvent, errorName: 'AiNotConfiguredError', errorCause: cause }, mockContext);

      const patch = updateQuestionFile.mock.calls[0][3];
      expect(patch.status).toBe('FAILED');
      expect(patch.errorMessage).toContain('AI is not configured');
      expect(patch.errorMessage).toContain('Bedrock API key');
    });

    it('detects AI-not-configured from the AI_NOT_CONFIGURED code alone', async () => {
      const cause = JSON.stringify({ errorType: 'Error', errorMessage: 'boom: AI_NOT_CONFIGURED' });

      await baseHandler({ ...validEvent, errorName: 'Error', errorCause: cause }, mockContext);

      expect(updateQuestionFile.mock.calls[0][3].errorMessage).toContain('AI is not configured');
    });

    it('uses the underlying Lambda error message for other failures', async () => {
      const cause = JSON.stringify({ errorType: 'Error', errorMessage: 'Model returned no text content' });

      await baseHandler({ ...validEvent, errorName: 'Error', errorCause: cause }, mockContext);

      expect(updateQuestionFile.mock.calls[0][3].errorMessage).toBe('Model returned no text content');
    });

    it('falls back to a generic message when there is no error detail', async () => {
      await baseHandler(validEvent, mockContext);

      expect(updateQuestionFile.mock.calls[0][3].errorMessage).toMatch(/Processing failed/i);
    });

    it('treats a non-JSON cause as the message', async () => {
      await baseHandler({ ...validEvent, errorName: 'States.Timeout', errorCause: 'raw failure text' }, mockContext);

      expect(updateQuestionFile.mock.calls[0][3].errorMessage).toBe('raw failure text');
    });

    it('truncates very long error messages', async () => {
      const long = 'x'.repeat(5000);
      const cause = JSON.stringify({ errorType: 'Error', errorMessage: long });

      await baseHandler({ ...validEvent, errorName: 'Error', errorCause: cause }, mockContext);

      expect(updateQuestionFile.mock.calls[0][3].errorMessage.length).toBe(1000);
    });
  });
});
