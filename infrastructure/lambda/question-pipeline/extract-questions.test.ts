/**
 * Regression tests for Sentry issues:
 * - AUTO-RFP-51: questionFileId, projectId, textFileKey are required
 * - AUTO-RFP-52: questionFileId and projectId required
 * - AUTO-RFP-2A: SyntaxError in JSON parsing
 */

// Mock uuid before importing module that uses it
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-v4'),
}));

import { baseHandler } from './extract-questions';

// Mock dependencies
jest.mock('../helpers/db', () => ({
  docClient: {
    send: jest.fn().mockResolvedValue({}),
  },
}));

jest.mock('../helpers/s3', () => ({
  loadTextFromS3: jest.fn().mockResolvedValue('Sample RFP text content'),
}));

jest.mock('../helpers/bedrock-http-client', () => ({
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

jest.mock('../sentry-lambda', () => ({
  withSentryLambda: (fn: any) => fn,
}));

describe('extract-questions Lambda - Input Validation (Sentry: AUTO-RFP-51, AUTO-RFP-52)', () => {
  const validEvent = {
    questionFileId: 'qf-123',
    projectId: 'proj-456',
    textFileKey: 'questions/extracted.txt',
  };

  const mockContext = {
    functionName: 'test',
    memoryLimitInMB: '128',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test',
    awsRequestId: 'request-123',
    getRemainingTimeInMillis: () => 30000,
  } as any;

  it('should throw when questionFileId is missing', async () => {
    const event = { projectId: 'proj-456', textFileKey: 'key.txt' };

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      'questionFileId, projectId, textFileKey are required'
    );
  });

  it('should throw when projectId is missing', async () => {
    const event = { questionFileId: 'qf-123', textFileKey: 'key.txt' };

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      'questionFileId, projectId, textFileKey are required'
    );
  });

  it('should throw when textFileKey is missing', async () => {
    const event = { questionFileId: 'qf-123', projectId: 'proj-456' };

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      'questionFileId, projectId, textFileKey are required'
    );
  });

  it('should throw when all required fields are missing', async () => {
    await expect(baseHandler({}, mockContext)).rejects.toThrow(
      'questionFileId, projectId, textFileKey are required'
    );
  });

  it('should throw when questionFileId is empty string', async () => {
    const event = { questionFileId: '', projectId: 'proj-456', textFileKey: 'key.txt' };

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      'questionFileId, projectId, textFileKey are required'
    );
  });

  it('should throw when projectId is empty string', async () => {
    const event = { questionFileId: 'qf-123', projectId: '', textFileKey: 'key.txt' };

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      'questionFileId, projectId, textFileKey are required'
    );
  });

  it('should throw when textFileKey is empty string', async () => {
    const event = { questionFileId: 'qf-123', projectId: 'proj-456', textFileKey: '' };

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      'questionFileId, projectId, textFileKey are required'
    );
  });

  it('should accept valid event with all required fields', async () => {
    const result = await baseHandler(validEvent, mockContext);
    expect(result).toHaveProperty('count');
    expect(typeof result.count).toBe('number');
  });
});

describe('extract-questions Lambda - JSON Parsing (Sentry: AUTO-RFP-2A)', () => {
  const { invokeModel } = require('../helpers/bedrock-http-client');
  const mockContext = {} as any;
  const validEvent = {
    questionFileId: 'qf-123',
    projectId: 'proj-456',
    textFileKey: 'questions/extracted.txt',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle malformed JSON response from Bedrock', async () => {
    invokeModel.mockResolvedValueOnce(
      new TextEncoder().encode('not valid json')
    );

    await expect(baseHandler(validEvent, mockContext)).rejects.toThrow(
      'Invalid JSON envelope from Bedrock'
    );
  });

  it('should handle truncated JSON (Sentry: AUTO-RFP-2A)', async () => {
    // Simulating JSON truncated at position 17526
    const truncatedJson = '{"content":[{"text":"{\\"sections\\":[{\\"title\\":\\"Test\\",\\"questions\\":[{\\"question\\":\\"';
    invokeModel.mockResolvedValueOnce(
      new TextEncoder().encode(truncatedJson)
    );

    await expect(baseHandler(validEvent, mockContext)).rejects.toThrow();
  });

  it('should handle response with no text content', async () => {
    invokeModel.mockResolvedValueOnce(
      new TextEncoder().encode(JSON.stringify({ content: [] }))
    );

    await expect(baseHandler(validEvent, mockContext)).rejects.toThrow(
      'Model returned no text content'
    );
  });

  it('should handle response missing sections array', async () => {
    invokeModel.mockResolvedValueOnce(
      new TextEncoder().encode(
        JSON.stringify({
          content: [{ text: '{}' }],
        })
      )
    );

    await expect(baseHandler(validEvent, mockContext)).rejects.toThrow(
      'Response missing required sections[]'
    );
  });
});
