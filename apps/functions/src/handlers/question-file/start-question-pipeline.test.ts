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
  SFNClient: jest.fn(() => ({
    send: jest.fn().mockResolvedValue({
      executionArn: 'arn:aws:states:us-east-1:123:execution:test:exec-1',
      startDate: new Date('2024-01-01'),
    }),
  })),
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
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  DeleteCommand: jest.fn((params) => ({ type: 'Delete', params })),
  BatchWriteCommand: jest.fn((params) => ({ type: 'BatchWrite', params })),
}));

import { baseHandler } from './start-question-pipeline';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

describe('start-question-pipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  const makeEvent = (body: unknown): AuthedEvent =>
    ({
      body: JSON.stringify(body),
      auth: { userId: 'user-001', orgId: 'org-123', claims: {} },
      requestContext: { http: { sourceIp: '1.2.3.4', userAgent: 'jest' } },
      headers: {},
      queryStringParameters: {},
    }) as unknown as AuthedEvent;

  it('returns 202 with executionArn on success', async () => {
    // getQuestionFileItem → found
    mockSend.mockResolvedValueOnce({
      Item: {
        partition_key: 'QUESTION_FILE',
        sort_key: 'proj-1#opp-1#qf-1',
        questionFileId: 'qf-1',
        fileKey: 'uploads/rfp.pdf',
        mimeType: 'application/pdf',
        status: 'UPLOADED',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    });
    // updateQuestionFile (set to PROCESSING)
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent({ projectId: 'proj-1', oppId: 'opp-1', questionFileId: 'qf-1' });
    const response = await baseHandler(event);

    expect(response).toMatchObject({ statusCode: 202 });
    const body = JSON.parse((response as { body: string }).body);
    expect(body.message).toBe('Question pipeline started');
    expect(body.questionFileId).toBe('qf-1');
    expect(body.executionArn).toBe('arn:aws:states:us-east-1:123:execution:test:exec-1');
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

  it('calls updateQuestionFile with PROCESSING status after pipeline start', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        partition_key: 'QUESTION_FILE',
        sort_key: 'proj-1#opp-1#qf-1',
        questionFileId: 'qf-1',
        fileKey: 'uploads/rfp.pdf',
        mimeType: 'application/pdf',
        status: 'UPLOADED',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    });
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent({ projectId: 'proj-1', oppId: 'opp-1', questionFileId: 'qf-1' });
    await baseHandler(event);

    // Second DynamoDB call should be the UpdateCommand for PROCESSING status
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(mockSend).toHaveBeenLastCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({
          ExpressionAttributeValues: expect.objectContaining({
            ':status': 'PROCESSING',
          }),
        }),
      }),
    );
  });
});
