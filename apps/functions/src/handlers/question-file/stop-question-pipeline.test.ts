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

// Mock Step Functions — use var so it is hoisted along with jest.mock
// eslint-disable-next-line no-var
var mockSfnSend = jest.fn();
jest.mock('@aws-sdk/client-sfn', () => ({
  SFNClient: jest.fn(() => ({ send: mockSfnSend })),
  StopExecutionCommand: jest.fn((params) => ({ type: 'StopExecution', params })),
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

import { baseHandler } from './stop-question-pipeline';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

describe('stop-question-pipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockSfnSend.mockReset();
  });

  const makeEvent = (body: unknown): AuthedEvent =>
    ({
      body: JSON.stringify(body),
      auth: { userId: 'user-001', orgId: 'org-123', claims: {} },
      requestContext: { http: { sourceIp: '1.2.3.4', userAgent: 'jest' } },
      headers: {},
      queryStringParameters: {},
    }) as unknown as AuthedEvent;

  // Must match the state machine name in QUESTION_PIPELINE_STATE_MACHINE_ARN env var
  // jest.setup.env.js sets: arn:aws:states:us-east-1:123456789:stateMachine:test
  const EXECUTION_ARN = 'arn:aws:states:us-east-1:123456789:execution:test:exec-1';

  it('returns 200 and stops execution successfully', async () => {
    // getQuestionFileItem → found with executionArn
    mockSend.mockResolvedValueOnce({
      Item: {
        partition_key: 'QUESTION_FILE',
        sort_key: 'proj-1#opp-1#qf-1',
        questionFileId: 'qf-1',
        status: 'PROCESSING',
        executionArn: EXECUTION_ARN,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    });
    // SFN StopExecution → success
    mockSfnSend.mockResolvedValueOnce({});
    // updateQuestionFile (set to CANCELLED)
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent({ projectId: 'proj-1', opportunityId: 'opp-1', questionFileId: 'qf-1' });
    const response = await baseHandler(event);

    expect(response).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((response as { body: string }).body);
    expect(body.ok).toBe(true);
    expect(body.message).toBe('Pipeline stopped successfully');
  });

  it('returns 200 and cancels when no executionArn present', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        partition_key: 'QUESTION_FILE',
        sort_key: 'proj-1#opp-1#qf-1',
        questionFileId: 'qf-1',
        status: 'UPLOADED',
        // no executionArn
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    });
    // updateQuestionFile (set to CANCELLED)
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent({ projectId: 'proj-1', opportunityId: 'opp-1', questionFileId: 'qf-1' });
    const response = await baseHandler(event);

    expect(response).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((response as { body: string }).body);
    expect(body.message).toBe('Pipeline cancelled (no active execution found)');
    expect(mockSfnSend).not.toHaveBeenCalled();
  });

  it('returns 200 when execution already completed (ExecutionDoesNotExist)', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        partition_key: 'QUESTION_FILE',
        sort_key: 'proj-1#opp-1#qf-1',
        questionFileId: 'qf-1',
        status: 'PROCESSING',
        executionArn: EXECUTION_ARN,
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    });
    // SFN StopExecution → execution not found
    const sfnError = new Error('Execution does not exist');
    (sfnError as { name?: string }).name = 'ExecutionDoesNotExist';
    mockSfnSend.mockRejectedValueOnce(sfnError);
    // updateQuestionFile (set to CANCELLED)
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent({ projectId: 'proj-1', opportunityId: 'opp-1', questionFileId: 'qf-1' });
    const response = await baseHandler(event);

    expect(response).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((response as { body: string }).body);
    expect(body.message).toBe('Pipeline cancelled (execution already completed or not found)');
  });

  it('returns 400 when body is missing', async () => {
    const event = { ...makeEvent({}), body: undefined } as unknown as AuthedEvent;
    const response = await baseHandler(event);

    expect(response).toMatchObject({ statusCode: 400 });
    const body = JSON.parse((response as { body: string }).body);
    expect(body.message).toBe('Request body is required');
  });

  it('returns 400 with issues when projectId is missing', async () => {
    const event = makeEvent({ opportunityId: 'opp-1', questionFileId: 'qf-1' });
    const response = await baseHandler(event);

    expect(response).toMatchObject({ statusCode: 400 });
    const body = JSON.parse((response as { body: string }).body);
    expect(body.message).toBe('Validation failed');
    expect(body.issues).toBeDefined();
  });

  it('returns 400 when opportunityId is missing', async () => {
    const event = makeEvent({ projectId: 'proj-1', questionFileId: 'qf-1' });
    const response = await baseHandler(event);

    expect(response).toMatchObject({ statusCode: 400 });
  });

  it('returns 400 when questionFileId is missing', async () => {
    const event = makeEvent({ projectId: 'proj-1', opportunityId: 'opp-1' });
    const response = await baseHandler(event);

    expect(response).toMatchObject({ statusCode: 400 });
  });

  it('returns 404 when question file does not exist', async () => {
    mockSend.mockResolvedValueOnce({ Item: undefined });

    const event = makeEvent({ projectId: 'proj-1', opportunityId: 'opp-1', questionFileId: 'qf-missing' });
    const response = await baseHandler(event);

    expect(response).toMatchObject({ statusCode: 404 });
    const body = JSON.parse((response as { body: string }).body);
    expect(body.message).toBe('Question file not found');
  });

  it('returns 403 when executionArn belongs to a different state machine', async () => {
    mockSend.mockResolvedValueOnce({
      Item: {
        partition_key: 'QUESTION_FILE',
        sort_key: 'proj-1#opp-1#qf-1',
        questionFileId: 'qf-1',
        status: 'PROCESSING',
        executionArn: 'arn:aws:states:us-east-1:123:execution:different-pipeline:exec-1',
        createdAt: '2024-01-01T00:00:00.000Z',
      },
    });

    const event = makeEvent({ projectId: 'proj-1', opportunityId: 'opp-1', questionFileId: 'qf-1' });
    const response = await baseHandler(event);

    expect(response).toMatchObject({ statusCode: 403 });
    const body = JSON.parse((response as { body: string }).body);
    expect(body.message).toContain('Invalid execution ARN');
  });
});
