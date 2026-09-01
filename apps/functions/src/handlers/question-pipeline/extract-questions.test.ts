/**
 * Regression tests for Sentry issues:
 * - AUTO-RFP-51: questionFileId, projectId, textFileKey, opportunityId are required
 * - AUTO-RFP-52: questionFileId and projectId required
 * - AUTO-RFP-2A: SyntaxError in JSON parsing
 */

// Mock uuid before importing module that uses it
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-v4'),
}));

import { baseHandler } from './extract-questions';

// Mock dependencies
jest.mock('@/helpers/db', () => ({
  docClient: {
    send: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('@/helpers/s3', () => ({
  loadTextFromS3: jest.fn().mockResolvedValue('Sample RFP text content'),
}));

jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: jest.fn().mockResolvedValue(
    new TextEncoder().encode(
      JSON.stringify({
        content: [
          {
            text: JSON.stringify({
              sections: [
                {
                  title: 'Technical Requirements',
                  questions: [{ question: 'Describe your approach.' }],
                },
              ],
            }),
          },
        ],
        stop_reason: 'end_turn',
      })
    )
  ),
}));

jest.mock('@/helpers/questionFile', () => ({
  checkQuestionFileCancelled: jest.fn().mockResolvedValue(false), // Default: not cancelled
  updateQuestionFile: jest.fn().mockResolvedValue({ success: true }),
  getQuestionFileItem: jest.fn().mockResolvedValue({
    questionFileId: 'qf-123',
    projectId: 'proj-456',
    orgId: 'org-1',
    status: 'PROCESSING',
  }),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: any) => fn,
}));

describe('extract-questions Lambda', () => {
  const mockContext = {
    functionName: 'test',
    memoryLimitInMB: '128',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test',
    awsRequestId: 'request-123',
    getRemainingTimeInMillis: () => 30000,
  } as any;

  const validEvent = {
    questionFileId: 'qf-123',
    projectId: 'proj-456',
    textFileKey: 'questions/extracted.txt',
    opportunityId: 'opp-789',
  };

  describe('Cancellation Check (runs first)', () => {
    const { checkQuestionFileCancelled } = require('@/helpers/questionFile');
    const { loadTextFromS3 } = require('@/helpers/s3');
    const { invokeModel } = require('@/helpers/bedrock-http-client');

    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return cancelled: true and skip all processing when cancelled', async () => {
      checkQuestionFileCancelled.mockResolvedValueOnce(true);

      const result = await baseHandler(validEvent, mockContext);

      expect(result).toEqual({
        cancelled: true,
        count: 0,
      });

      // Verify no resources were wasted
      expect(loadTextFromS3).not.toHaveBeenCalled();
      expect(invokeModel).not.toHaveBeenCalled();
    });

    it('should return cancelled even with invalid input (cancellation check before validation)', async () => {
      checkQuestionFileCancelled.mockResolvedValueOnce(true);

      // Event missing required fields
      const invalidEvent = {
        questionFileId: 'qf-123',
        projectId: 'proj-456',
        opportunityId: 'opp-789',
        // textFileKey missing
      };

      const result = await baseHandler(invalidEvent as any, mockContext);

      // Should NOT throw validation error - returns cancelled instead
      expect(result).toEqual({
        cancelled: true,
        count: 0,
      });
    });
  });

  describe('Input Validation (runs after cancellation check passes)', () => {
    const { checkQuestionFileCancelled } = require('@/helpers/questionFile');

    beforeEach(() => {
      jest.clearAllMocks();
      // Mock cancellation check to always return false for validation tests
      checkQuestionFileCancelled.mockResolvedValue(false);
    });

    it('should throw when questionFileId is missing', async () => {
      const event = { projectId: 'proj-456', textFileKey: 'key.txt', opportunityId: 'opp-789' } as any;

      await expect(baseHandler(event, mockContext)).rejects.toThrow(
        'Missing required fields: questionFileId'
      );
    });

    it('should throw when projectId is missing', async () => {
      const event = { questionFileId: 'qf-123', textFileKey: 'key.txt', opportunityId: 'opp-789' } as any;

      await expect(baseHandler(event, mockContext)).rejects.toThrow(
        'Missing required fields: projectId'
      );
    });

    it('should throw when textFileKey is missing', async () => {
      const event = { questionFileId: 'qf-123', projectId: 'proj-456', opportunityId: 'opp-789' } as any;

      await expect(baseHandler(event, mockContext)).rejects.toThrow(
        'Missing required fields: textFileKey'
      );
    });

    it('should throw when opportunityId is missing', async () => {
      const event = { questionFileId: 'qf-123', projectId: 'proj-456', textFileKey: 'key.txt' } as any;

      await expect(baseHandler(event, mockContext)).rejects.toThrow(
        'Missing required fields: opportunityId'
      );
    });

    it('should throw when questionFileId is empty string', async () => {
      const event = { questionFileId: '', projectId: 'proj-456', textFileKey: 'key.txt', opportunityId: 'opp-789' };

      await expect(baseHandler(event, mockContext)).rejects.toThrow(
        'Missing required fields: questionFileId'
      );
    });

    it('should throw when projectId is empty string', async () => {
      const event = { questionFileId: 'qf-123', projectId: '', textFileKey: 'key.txt', opportunityId: 'opp-789' };

      await expect(baseHandler(event, mockContext)).rejects.toThrow(
        'Missing required fields: projectId'
      );
    });

    it('should throw when textFileKey is empty string', async () => {
      const event = { questionFileId: 'qf-123', projectId: 'proj-456', textFileKey: '', opportunityId: 'opp-789' };

      await expect(baseHandler(event, mockContext)).rejects.toThrow(
        'Missing required fields: textFileKey'
      );
    });

    it('should accept valid event with all required fields', async () => {
      const result = await baseHandler(validEvent, mockContext);
      expect(result).toHaveProperty('count');
      expect(typeof result.count).toBe('number');
      expect(result.cancelled).toBe(false);
    });
  });

  describe('orgId propagation to Bedrock', () => {
    const { checkQuestionFileCancelled, getQuestionFileItem } = require('@/helpers/questionFile');
    const { invokeModel } = require('@/helpers/bedrock-http-client');

    beforeEach(() => {
      jest.clearAllMocks();
      checkQuestionFileCancelled.mockResolvedValue(false);
    });

    it('reads orgId from the question file and passes it as the 3rd arg to invokeModel', async () => {
      getQuestionFileItem.mockResolvedValue({
        questionFileId: 'qf-123',
        projectId: 'proj-456',
        orgId: 'org-1',
        status: 'PROCESSING',
      });

      await baseHandler(validEvent, mockContext);

      expect(invokeModel).toHaveBeenCalledWith(
        expect.anything(),
        expect.any(String),
        'org-1',
      );
    });

    it('throws when the question file has no orgId (per-org Bedrock key is required)', async () => {
      // `mockResolvedValueOnce` so this orgId-less item does not leak into later
      // describes (clearAllMocks resets calls, not implementations).
      getQuestionFileItem.mockResolvedValueOnce({
        questionFileId: 'qf-123',
        projectId: 'proj-456',
        status: 'PROCESSING',
      });

      await expect(baseHandler(validEvent, mockContext)).rejects.toThrow(/no orgId/i);
      expect(invokeModel).not.toHaveBeenCalled();
    });
  });

  describe('JSON Parsing (Sentry: AUTO-RFP-2A)', () => {
    const { checkQuestionFileCancelled } = require('@/helpers/questionFile');
    const { invokeModel } = require('@/helpers/bedrock-http-client');

    beforeEach(() => {
      jest.clearAllMocks();
      checkQuestionFileCancelled.mockResolvedValue(false);
    });

    it('should handle malformed JSON response from Bedrock gracefully', async () => {
      invokeModel.mockResolvedValueOnce(
        new TextEncoder().encode('not valid json')
      );

      const result = await baseHandler(validEvent, mockContext);
      expect(result.count).toBe(0);
    });

    it('should handle truncated JSON gracefully (Sentry: AUTO-RFP-2A)', async () => {
      const truncatedJson = '{"content":[{"text":"{\\"sections\\":[{\\"title\\":\\"Test\\",\\"questions\\":[{\\"question\\":\\"';
      invokeModel.mockResolvedValueOnce(
        new TextEncoder().encode(truncatedJson)
      );

      const result = await baseHandler(validEvent, mockContext);
      expect(result.count).toBe(0);
    });

    it('should handle response with no text content gracefully', async () => {
      invokeModel.mockResolvedValueOnce(
        new TextEncoder().encode(JSON.stringify({ content: [] }))
      );

      const result = await baseHandler(validEvent, mockContext);
      expect(result.count).toBe(0);
    });

    it('should handle response missing sections array gracefully', async () => {
      invokeModel.mockResolvedValueOnce(
        new TextEncoder().encode(
          JSON.stringify({
            content: [{ text: '{}' }],
          })
        )
      );

      const result = await baseHandler(validEvent, mockContext);
      expect(result.count).toBe(0);
    });
  });

  /**
   * Regression tests for Sentry AUTO-RFP-FT: "AI imported radio button
   * multiple-choice questions separately, not as a whole." A radio/checkbox
   * question must persist as ONE row carrying responseKind + options, not one
   * row per option.
   */
  describe('Multiple-choice extraction (Sentry: AUTO-RFP-FT)', () => {
    const { checkQuestionFileCancelled } = require('@/helpers/questionFile');
    const { invokeModel } = require('@/helpers/bedrock-http-client');
    const { docClient } = require('@/helpers/db');

    beforeEach(() => {
      jest.clearAllMocks();
      checkQuestionFileCancelled.mockResolvedValue(false);
    });

    /** Collect the Items written by PutCommand across all docClient.send calls. */
    const capturedItems = (): Array<Record<string, unknown>> =>
      (docClient.send as jest.Mock).mock.calls
        .map(([cmd]) => cmd?.input?.Item)
        .filter(Boolean);

    it('persists a single-choice question as ONE row with responseKind + options', async () => {
      invokeModel.mockResolvedValueOnce(
        new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                text: JSON.stringify({
                  sections: [
                    {
                      title: 'Qualifications',
                      questions: [
                        {
                          question: 'Which cloud provider do you primarily use?',
                          responseKind: 'SINGLE_CHOICE',
                          options: [
                            { label: 'AWS', value: 'A' },
                            { label: 'Azure', value: 'B' },
                            { label: 'GCP', value: 'C' },
                          ],
                        },
                      ],
                    },
                  ],
                }),
              },
            ],
            stop_reason: 'end_turn',
          })
        )
      );

      const result = await baseHandler(validEvent, mockContext);

      expect(result.count).toBe(1); // ONE question, not one-per-option
      const items = capturedItems();
      expect(items).toHaveLength(1);
      expect(items[0]!.question).toBe('Which cloud provider do you primarily use?');
      expect(items[0]!.responseKind).toBe('SINGLE_CHOICE');
      expect(items[0]!.options).toEqual([
        { label: 'AWS', value: 'A' },
        { label: 'Azure', value: 'B' },
        { label: 'GCP', value: 'C' },
      ]);
    });

    it('persists a multi-choice question with its options', async () => {
      invokeModel.mockResolvedValueOnce(
        new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                text: JSON.stringify({
                  sections: [
                    {
                      title: 'Capabilities',
                      questions: [
                        {
                          question: 'Which certifications does your team hold?',
                          responseKind: 'MULTI_CHOICE',
                          options: [{ label: 'CISSP' }, { label: 'PMP' }],
                        },
                      ],
                    },
                  ],
                }),
              },
            ],
            stop_reason: 'end_turn',
          })
        )
      );

      const result = await baseHandler(validEvent, mockContext);

      expect(result.count).toBe(1);
      const items = capturedItems();
      expect(items[0]!.responseKind).toBe('MULTI_CHOICE');
      expect(items[0]!.options).toEqual([{ label: 'CISSP' }, { label: 'PMP' }]);
    });

    it('collapses interior whitespace in option labels so they never contain the delimiter', async () => {
      // A wrapped label ("Line one\nLine two") would otherwise serialize into
      // two newline-joined "options" on the frontend and never round-trip as
      // selected. Interior whitespace (incl. newlines) is collapsed to a space.
      invokeModel.mockResolvedValueOnce(
        new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                text: JSON.stringify({
                  sections: [
                    {
                      title: 'Capabilities',
                      questions: [
                        {
                          question: 'Pick one.',
                          responseKind: 'SINGLE_CHOICE',
                          options: [
                            { label: 'Line one\nLine two' },
                            { label: '  Yes  ' },
                          ],
                        },
                      ],
                    },
                  ],
                }),
              },
            ],
            stop_reason: 'end_turn',
          })
        )
      );

      const result = await baseHandler(validEvent, mockContext);

      expect(result.count).toBe(1);
      const items = capturedItems();
      expect(items[0]!.options).toEqual([{ label: 'Line one Line two' }, { label: 'Yes' }]);
    });

    it('degrades a choice question with no usable options to plain text', async () => {
      invokeModel.mockResolvedValueOnce(
        new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                text: JSON.stringify({
                  sections: [
                    {
                      title: 'Technical',
                      questions: [
                        {
                          question: 'Describe your approach.',
                          responseKind: 'SINGLE_CHOICE',
                          options: [],
                        },
                      ],
                    },
                  ],
                }),
              },
            ],
            stop_reason: 'end_turn',
          })
        )
      );

      const result = await baseHandler(validEvent, mockContext);

      expect(result.count).toBe(1);
      const items = capturedItems();
      // Neither field should be written for a degraded text question.
      expect(items[0]!.responseKind).toBeUndefined();
      expect(items[0]!.options).toBeUndefined();
    });

    it('leaves free-text questions with no responseKind/options', async () => {
      // Uses the default mock (a single plain-text question).
      const result = await baseHandler(validEvent, mockContext);

      expect(result.count).toBe(1);
      const items = capturedItems();
      expect(items[0]!.responseKind).toBeUndefined();
      expect(items[0]!.options).toBeUndefined();
    });
  });
});