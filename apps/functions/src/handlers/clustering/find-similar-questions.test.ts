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
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
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

// Mock clustering helpers
const mockGetQuestionById = jest.fn();
const mockFindSimilarInPinecone = jest.fn();
const mockEnrichSimilarMatches = jest.fn();
jest.mock('@/helpers/clustering', () => ({
  getQuestionById: mockGetQuestionById,
  findSimilarInPinecone: mockFindSimilarInPinecone,
  enrichSimilarMatches: mockEnrichSimilarMatches,
}));

// Mock organization helper
const mockGetOrganizationById = jest.fn();
jest.mock('@/helpers/org', () => ({
  getOrganizationById: mockGetOrganizationById,
}));

// Mock API helpers
jest.mock('@/helpers/api', () => ({
  apiResponse: jest.fn((statusCode: number, body: unknown) => ({
    statusCode,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })),
  getOrgId: jest.fn(() => 'org-123'),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.PINECONE_INDEX = 'test-index';

import { baseHandler } from './find-similar-questions';
import { setAuditContext } from '@/middleware/audit-middleware';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

// Helper to extract body from APIGatewayProxyResultV2
const parseResult = (result: unknown) => {
  const r = result as { statusCode: number; body: string };
  return { statusCode: r.statusCode, body: JSON.parse(r.body) };
};

const createEvent = (overrides: Partial<AuthedEvent> = {}): AuthedEvent => ({
  pathParameters: { projectId: 'proj-123', questionId: 'q-123' },
  queryStringParameters: { orgId: 'org-123' },
  headers: {},
  body: null,
  isBase64Encoded: false,
  requestContext: {} as AuthedEvent['requestContext'],
  auth: { userId: 'user-1', claims: {} },
  ...overrides,
} as AuthedEvent);

describe('find-similar-questions handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockGetQuestionById.mockReset();
    mockFindSimilarInPinecone.mockReset();
    mockEnrichSimilarMatches.mockReset();
    mockGetOrganizationById.mockReset();
  });

  it('returns 400 when projectId is missing', async () => {
    const event = createEvent({ pathParameters: { questionId: 'q-123' } });
    const { statusCode, body } = parseResult(await baseHandler(event));
    expect(statusCode).toBe(400);
    expect(body.message).toBe('Missing projectId or questionId');
  });

  it('returns 400 when questionId is missing', async () => {
    const event = createEvent({ pathParameters: { projectId: 'proj-123' } });
    const { statusCode } = parseResult(await baseHandler(event));
    expect(statusCode).toBe(400);
  });

  it('returns 404 when question not found', async () => {
    mockGetQuestionById.mockResolvedValue(null);

    const event = createEvent();
    const { statusCode, body } = parseResult(await baseHandler(event));
    expect(statusCode).toBe(404);
    expect(body.message).toBe('Question not found');
  });

  it('returns 404 when question has no text', async () => {
    mockGetQuestionById.mockResolvedValue({ questionId: 'q-123', question: '' });

    const event = createEvent();
    const { statusCode } = parseResult(await baseHandler(event));
    expect(statusCode).toBe(404);
  });

  it('returns similar questions on happy path', async () => {
    mockGetQuestionById.mockResolvedValue({
      questionId: 'q-123',
      question: 'What is the project timeline?',
      clusterId: 'cluster-1',
    });
    mockGetOrganizationById.mockResolvedValue({ similarThreshold: 0.6 });
    mockFindSimilarInPinecone.mockResolvedValue([
      { questionId: 'q-456', similarity: 0.85, questionText: 'Timeline?' },
    ]);
    mockEnrichSimilarMatches.mockResolvedValue([
      {
        questionId: 'q-456',
        questionText: 'What is the timeline?',
        similarity: 0.85,
        hasAnswer: true,
        answerPreview: 'The timeline is...',
        inSameCluster: true,
        clusterId: 'cluster-1',
      },
    ]);

    const event = createEvent();
    const { statusCode, body } = parseResult(await baseHandler(event));

    expect(statusCode).toBe(200);
    expect(body.questionId).toBe('q-123');
    expect(body.questionText).toBe('What is the project timeline?');
    expect(body.similarQuestions).toHaveLength(1);
    expect(body.similarQuestions[0].questionId).toBe('q-456');
  });

  it('uses org-level threshold when no explicit threshold provided', async () => {
    mockGetQuestionById.mockResolvedValue({
      questionId: 'q-123',
      question: 'What is the budget?',
    });
    mockGetOrganizationById.mockResolvedValue({ similarThreshold: 0.7 });
    mockFindSimilarInPinecone.mockResolvedValue([]);
    mockEnrichSimilarMatches.mockResolvedValue([]);

    const event = createEvent();
    await baseHandler(event);

    expect(mockFindSimilarInPinecone).toHaveBeenCalledWith(
      'org-123', 'proj-123', 'What is the budget?', 'q-123', 0.7, 20,
    );
  });

  it('uses explicit threshold when provided', async () => {
    mockGetQuestionById.mockResolvedValue({
      questionId: 'q-123',
      question: 'What is the budget?',
    });
    mockFindSimilarInPinecone.mockResolvedValue([]);
    mockEnrichSimilarMatches.mockResolvedValue([]);

    const event = createEvent({
      queryStringParameters: { orgId: 'org-123', threshold: '0.8', limit: '5' },
    });
    await baseHandler(event);

    expect(mockFindSimilarInPinecone).toHaveBeenCalledWith(
      'org-123', 'proj-123', 'What is the budget?', 'q-123', 0.8, 5,
    );
    // Should NOT call getOrganizationById when threshold is explicit
    expect(mockGetOrganizationById).not.toHaveBeenCalled();
  });

  it('falls back to default threshold when org lookup fails', async () => {
    mockGetQuestionById.mockResolvedValue({
      questionId: 'q-123',
      question: 'What is the budget?',
    });
    mockGetOrganizationById.mockRejectedValue(new Error('Org not found'));
    mockFindSimilarInPinecone.mockResolvedValue([]);
    mockEnrichSimilarMatches.mockResolvedValue([]);

    const event = createEvent();
    await baseHandler(event);

    // Should use default SIMILAR_THRESHOLD (0.50)
    expect(mockFindSimilarInPinecone).toHaveBeenCalledWith(
      'org-123', 'proj-123', 'What is the budget?', 'q-123', 0.5, 20,
    );
  });

  it('returns empty array when no similar questions found', async () => {
    mockGetQuestionById.mockResolvedValue({
      questionId: 'q-123',
      question: 'Unique question',
    });
    mockGetOrganizationById.mockResolvedValue({});
    mockFindSimilarInPinecone.mockResolvedValue([]);
    mockEnrichSimilarMatches.mockResolvedValue([]);

    const event = createEvent();
    const { body } = parseResult(await baseHandler(event));

    expect(body.similarQuestions).toEqual([]);
  });

  it('sets audit context with SIMILAR_QUESTIONS_SEARCHED action', async () => {
    mockGetQuestionById.mockResolvedValue({
      questionId: 'q-123',
      question: 'What is the budget?',
    });
    mockGetOrganizationById.mockResolvedValue({});
    mockFindSimilarInPinecone.mockResolvedValue([]);
    mockEnrichSimilarMatches.mockResolvedValue([]);

    const event = createEvent();
    await baseHandler(event);

    expect(setAuditContext).toHaveBeenCalledWith(
      event,
      expect.objectContaining({
        action: 'SIMILAR_QUESTIONS_SEARCHED',
        resource: 'question',
        resourceId: 'q-123',
        orgId: 'org-123',
      }),
    );
  });

  it('clamps threshold to valid range', async () => {
    mockGetQuestionById.mockResolvedValue({
      questionId: 'q-123',
      question: 'What is the budget?',
    });
    mockFindSimilarInPinecone.mockResolvedValue([]);
    mockEnrichSimilarMatches.mockResolvedValue([]);

    const event = createEvent({
      queryStringParameters: { orgId: 'org-123', threshold: '2.0' },
    });
    await baseHandler(event);

    // Should clamp to 1.0
    expect(mockFindSimilarInPinecone).toHaveBeenCalledWith(
      'org-123', 'proj-123', 'What is the budget?', 'q-123', 1, expect.any(Number),
    );
  });

  it('does not mention token in error message', async () => {
    // Verify the error message doesn't reference "token"
    const { getOrgId } = jest.requireMock('@/helpers/api');
    (getOrgId as jest.Mock).mockReturnValueOnce(null);

    mockGetQuestionById.mockResolvedValue({
      questionId: 'q-123',
      question: 'What is the budget?',
    });

    const event = createEvent();
    const { body } = parseResult(await baseHandler(event));

    expect(body.message).not.toContain('token');
    expect(body.message).toContain('Organization ID is required');
  });
});
