// Mock middy before importing handlers (ESM compatibility)
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

// Mock AWS SDK
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
}));

// Mock Sentry
jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
}));

// Mock audit middleware
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ before: jest.fn(), after: jest.fn() })),
  setAuditContext: jest.fn(),
}));

// Mock answer helper
const mockGetAnswerForQuestion = jest.fn();
jest.mock('@/helpers/answer', () => ({
  getAnswerForQuestion: mockGetAnswerForQuestion,
  buildAnswerSK: jest.fn((...args: string[]) => args.join('#')),
}));

// Mock save answer
const mockSaveAnswer = jest.fn();
jest.mock('@/handlers/answer/save-answer', () => ({
  saveAnswer: mockSaveAnswer,
}));

// Mock question helper
jest.mock('@/helpers/question', () => ({
  buildQuestionSK: jest.fn((...args: string[]) => args.join('#')),
}));

// Mock API helpers
jest.mock('@/helpers/api', () => ({
  apiResponse: jest.fn((statusCode: number, body: unknown) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })),
}));

// Mock date helper
jest.mock('@/helpers/date', () => ({
  nowIso: jest.fn(() => '2026-01-01T00:00:00.000Z'),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './apply-cluster-answer';
import { setAuditContext } from '@/middleware/audit-middleware';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

// Helper to extract body from APIGatewayProxyResultV2
const parseResult = (result: unknown) => {
  const r = result as { statusCode: number; body: string };
  return { statusCode: r.statusCode, body: JSON.parse(r.body) };
};

const createEvent = (body: Record<string, unknown>, overrides: Partial<AuthedEvent> = {}): AuthedEvent => ({
  pathParameters: {},
  queryStringParameters: { orgId: 'org-123' },
  headers: {},
  body: JSON.stringify(body),
  isBase64Encoded: false,
  requestContext: {} as AuthedEvent['requestContext'],
  auth: { userId: 'user-1', claims: {} },
  ...overrides,
} as AuthedEvent);

describe('apply-cluster-answer handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockGetAnswerForQuestion.mockReset();
    mockSaveAnswer.mockReset();
  });

  it('returns 400 when body is missing', async () => {
    const event = { ...createEvent({}), body: null } as unknown as AuthedEvent;
    const { statusCode, body } = parseResult(await baseHandler(event));
    expect(statusCode).toBe(400);
    expect(body.message).toBe('Request body is required');
  });

  it('returns 400 when validation fails', async () => {
    const event = createEvent({ projectId: '' }); // empty projectId
    const { statusCode, body } = parseResult(await baseHandler(event));
    expect(statusCode).toBe(400);
    expect(body.message).toBe('Validation failed');
  });

  it('returns 400 when orgId is missing', async () => {
    const event = createEvent({
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      sourceQuestionId: 'q-source',
      targetQuestionIds: ['q-target'],
    });
    const { statusCode, body } = parseResult(await baseHandler(event));
    expect(statusCode).toBe(400);
    expect(body.message).toBe('Validation failed');
  });

  it('returns 404 when source question has no answer', async () => {
    mockGetAnswerForQuestion.mockResolvedValue(null);

    const event = createEvent({
      orgId: 'org-123',
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      sourceQuestionId: 'q-source',
      targetQuestionIds: ['q-target'],
    });
    const { statusCode, body } = parseResult(await baseHandler(event));
    expect(statusCode).toBe(404);
    expect(body.message).toBe('Source question has no answer to apply');
  });

  it('successfully applies answer to target questions', async () => {
    mockGetAnswerForQuestion.mockResolvedValue({
      text: 'The answer is 42',
      confidence: 0.9,
      sources: [],
    });
    mockSaveAnswer.mockResolvedValue({});
    mockSend.mockResolvedValue({ Attributes: {} }); // for updateItem

    const event = createEvent({
      orgId: 'org-123',
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      sourceQuestionId: 'q-source',
      targetQuestionIds: ['q-target-1', 'q-target-2'],
    });
    const { statusCode, body } = parseResult(await baseHandler(event));

    expect(statusCode).toBe(200);
    expect(body.sourceQuestionId).toBe('q-source');
    expect(body.applied).toEqual(['q-target-1', 'q-target-2']);
    expect(body.failed).toEqual([]);
    expect(mockSaveAnswer).toHaveBeenCalledTimes(2);
  });

  it('rejects applying answer to itself', async () => {
    mockGetAnswerForQuestion.mockResolvedValue({
      text: 'The answer',
      confidence: 0.9,
      sources: [],
    });

    const event = createEvent({
      orgId: 'org-123',
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      sourceQuestionId: 'q-source',
      targetQuestionIds: ['q-source'],
    });
    const { body } = parseResult(await baseHandler(event));

    expect(body.applied).toEqual([]);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].reason).toBe('Cannot apply answer to itself');
  });

  it('handles partial failures gracefully', async () => {
    mockGetAnswerForQuestion.mockResolvedValue({
      text: 'The answer',
      confidence: 0.9,
      sources: [],
    });
    mockSaveAnswer
      .mockResolvedValueOnce({}) // first target succeeds
      .mockRejectedValueOnce(new Error('DynamoDB error')); // second target fails
    mockSend.mockResolvedValue({ Attributes: {} });

    const event = createEvent({
      orgId: 'org-123',
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      sourceQuestionId: 'q-source',
      targetQuestionIds: ['q-target-1', 'q-target-2'],
    });
    const { body } = parseResult(await baseHandler(event));

    expect(body.applied).toHaveLength(1);
    expect(body.failed).toHaveLength(1);
    expect(body.failed[0].reason).toBe('DynamoDB error');
  });

  it('uses customText when provided', async () => {
    mockGetAnswerForQuestion.mockResolvedValue({
      text: 'Original answer',
      confidence: 0.9,
      sources: [],
    });
    mockSaveAnswer.mockResolvedValue({});
    mockSend.mockResolvedValue({ Attributes: {} });

    const event = createEvent({
      orgId: 'org-123',
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      sourceQuestionId: 'q-source',
      targetQuestionIds: ['q-target'],
      customText: 'Custom answer text',
    });
    await baseHandler(event);

    expect(mockSaveAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Custom answer text' }),
    );
  });

  it('sets audit context with CLUSTER_ANSWER_APPLIED action', async () => {
    mockGetAnswerForQuestion.mockResolvedValue({
      text: 'The answer',
      confidence: 0.9,
      sources: [],
    });
    mockSaveAnswer.mockResolvedValue({});
    mockSend.mockResolvedValue({ Attributes: {} });

    const event = createEvent({
      orgId: 'org-123',
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      sourceQuestionId: 'q-source',
      targetQuestionIds: ['q-target'],
    });
    await baseHandler(event);

    expect(setAuditContext).toHaveBeenCalledWith(
      event,
      expect.objectContaining({
        action: 'CLUSTER_ANSWER_APPLIED',
        resource: 'answer',
        resourceId: 'q-source',
        orgId: 'org-123',
      }),
    );
  });
});
