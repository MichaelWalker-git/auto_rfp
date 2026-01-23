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
    opportunityId: 'opp-789',
  };

  const mockContext = {
    functionName: 'test',
    memoryLimitInMB: '128',
    invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789:function:test',
    awsRequestId: 'request-123',
    getRemainingTimeInMillis: () => 30000,
  } as any;

  it('should throw when questionFileId is missing', async () => {
    const event = { projectId: 'proj-456', textFileKey: 'key.txt', opportunityId: 'opp-789' } as any;

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      'questionFileId, projectId, textFileKey, opportunityId are required'
    );
  });

  it('should throw when projectId is missing', async () => {
    const event = { questionFileId: 'qf-123', textFileKey: 'key.txt', opportunityId: 'opp-789' } as any;

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      'questionFileId, projectId, textFileKey, opportunityId are required'
    );
  });

  it('should throw when textFileKey is missing', async () => {
    const event = { questionFileId: 'qf-123', projectId: 'proj-456', opportunityId: 'opp-789' } as any;

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      'questionFileId, projectId, textFileKey, opportunityId are required'
    );
  });

  it('should throw when opportunityId is missing', async () => {
    const event = { questionFileId: 'qf-123', projectId: 'proj-456', textFileKey: 'key.txt' } as any;

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      'questionFileId, projectId, textFileKey, opportunityId are required'
    );
  });

  it('should throw when all required fields are missing', async () => {
    await expect(baseHandler({} as any, mockContext)).rejects.toThrow(
      'questionFileId, projectId, textFileKey, opportunityId are required'
    );
  });

  it('should throw when questionFileId is empty string', async () => {
    const event = { questionFileId: '', projectId: 'proj-456', textFileKey: 'key.txt', opportunityId: 'opp-789' };

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      'questionFileId, projectId, textFileKey, opportunityId are required'
    );
  });

  it('should throw when projectId is empty string', async () => {
    const event = { questionFileId: 'qf-123', projectId: '', textFileKey: 'key.txt', opportunityId: 'opp-789' };

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      'questionFileId, projectId, textFileKey, opportunityId are required'
    );
  });

  it('should throw when textFileKey is empty string', async () => {
    const event = { questionFileId: 'qf-123', projectId: 'proj-456', textFileKey: '', opportunityId: 'opp-789' };

    await expect(baseHandler(event, mockContext)).rejects.toThrow(
      'questionFileId, projectId, textFileKey, opportunityId are required'
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
    opportunityId: 'opp-789',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle malformed JSON response from Bedrock gracefully', async () => {
    invokeModel.mockResolvedValueOnce(
      new TextEncoder().encode('not valid json')
    );

    // Handler now handles this gracefully and returns count: 0
    const result = await baseHandler(validEvent, mockContext);
    expect(result.count).toBe(0);
  });

  it('should handle truncated JSON gracefully (Sentry: AUTO-RFP-2A)', async () => {
    // Simulating JSON truncated at position 17526
    const truncatedJson = '{"content":[{"text":"{\\"sections\\":[{\\"title\\":\\"Test\\",\\"questions\\":[{\\"question\\":\\"';
    invokeModel.mockResolvedValueOnce(
      new TextEncoder().encode(truncatedJson)
    );

    // Handler now handles this gracefully and returns count: 0
    const result = await baseHandler(validEvent, mockContext);
    expect(result.count).toBe(0);
  });

  it('should handle response with no text content gracefully', async () => {
    invokeModel.mockResolvedValueOnce(
      new TextEncoder().encode(JSON.stringify({ content: [] }))
    );

    // Handler now handles this gracefully and returns count: 0
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

    // Handler now handles this gracefully and returns count: 0
    const result = await baseHandler(validEvent, mockContext);
    expect(result.count).toBe(0);
  });
});
