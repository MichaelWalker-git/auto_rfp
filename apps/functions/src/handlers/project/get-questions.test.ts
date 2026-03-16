/**
 * Unit tests for get-questions handler.
 *
 * Verifies the batch-loading approach (2 DynamoDB queries) that replaced
 * the old N+1 pattern which caused Lambda timeouts.
 */

// ── Mocks (must be before imports) ─────────────────────────────────────

jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  DeleteCommand: jest.fn((params) => ({ type: 'Delete', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
  ScanCommand: jest.fn((params) => ({ type: 'Scan', params })),
  BatchWriteCommand: jest.fn((params) => ({ type: 'BatchWrite', params })),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (h: unknown) => h,
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({ before: jest.fn() }),
  httpErrorMiddleware: () => ({ onError: jest.fn() }),
  orgMembershipMiddleware: () => ({ before: jest.fn() }),
  requirePermission: () => ({ before: jest.fn() }),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

// ── Import after mocks ─────────────────────────────────────────────────

import { baseHandler } from './get-questions';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

// ── Helpers ─────────────────────────────────────────────────────────────

interface LambdaResponse {
  statusCode: number;
  body: string;
  headers?: Record<string, string>;
}

const makeEvent = (projectId?: string): APIGatewayProxyEventV2 =>
  ({
    pathParameters: projectId ? { projectId } : {},
    queryStringParameters: {},
    headers: {},
    body: null,
  }) as unknown as APIGatewayProxyEventV2;

const parseBody = (result: LambdaResponse) =>
  JSON.parse(result.body);

// ── Tests ───────────────────────────────────────────────────────────────

describe('get-questions handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  // ── Validation ──────────────────────────────────────────────────────

  it('should return 400 when projectId is missing', async () => {
    const result = await baseHandler(makeEvent()) as LambdaResponse;

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).message).toBe('Missing projectId');
  });

  // ── Happy path ──────────────────────────────────────────────────────

  it('should return sections and answers for a valid project', async () => {
    // First call: loadQuestions
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          partition_key: 'QUESTION',
          sort_key: 'proj-1#sec-1#q-1',
          questionId: 'q-1',
          question: 'What is your approach?',
          sectionId: 'sec-1',
          sectionTitle: 'Technical Approach',
          sectionDescription: 'Describe your approach',
          opportunityId: 'opp-1',
          questionFileId: 'file-1',
        },
        {
          partition_key: 'QUESTION',
          sort_key: 'proj-1#sec-1#q-2',
          questionId: 'q-2',
          question: 'What is your timeline?',
          sectionId: 'sec-1',
          sectionTitle: 'Technical Approach',
          sectionDescription: 'Describe your approach',
          opportunityId: 'opp-1',
          questionFileId: 'file-1',
        },
      ],
      LastEvaluatedKey: undefined,
    });

    // Second call: loadAnswers
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          partition_key: 'ANSWER',
          sort_key: 'proj-1#q-1#ans-1',
          questionId: 'q-1',
          text: 'Our approach is...',
          sources: [],
          createdAt: '2026-03-01T00:00:00Z',
          updatedAt: '2026-03-01T00:00:00Z',
        },
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await baseHandler(makeEvent('proj-1')) as LambdaResponse;

    expect(result.statusCode).toBe(200);

    const body = parseBody(result);

    // Verify sections structure
    expect(body.sections).toHaveLength(1);
    expect(body.sections[0].id).toBe('sec-1');
    expect(body.sections[0].title).toBe('Technical Approach');
    expect(body.sections[0].questions).toHaveLength(2);

    // Verify question data
    expect(body.sections[0].questions[0].id).toBe('q-1');
    expect(body.sections[0].questions[0].question).toBe('What is your approach?');
    expect(body.sections[0].questions[0].answer).toBe('Our approach is...');
    expect(body.sections[0].questions[0].opportunityId).toBe('opp-1');

    // Verify unanswered question has null answer
    expect(body.sections[0].questions[1].id).toBe('q-2');
    expect(body.sections[0].questions[1].answer).toBeNull();

    // Verify answers map is included in response
    expect(body.answers).toBeDefined();
    expect(body.answers['q-1']).toBeDefined();
    expect(body.answers['q-1'].text).toBe('Our approach is...');
  });

  it('should group questions into multiple sections', async () => {
    // loadQuestions
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          questionId: 'q-1',
          question: 'Q1',
          sectionId: 'sec-1',
          sectionTitle: 'Section A',
        },
        {
          questionId: 'q-2',
          question: 'Q2',
          sectionId: 'sec-2',
          sectionTitle: 'Section B',
        },
        {
          questionId: 'q-3',
          question: 'Q3',
          sectionId: 'sec-1',
          sectionTitle: 'Section A',
        },
      ],
      LastEvaluatedKey: undefined,
    });

    // loadAnswers — no answers
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await baseHandler(makeEvent('proj-1')) as LambdaResponse;
    const body = parseBody(result);

    expect(result.statusCode).toBe(200);
    expect(body.sections).toHaveLength(2);
    expect(body.sections[0].questions).toHaveLength(2); // sec-1 has q-1 and q-3
    expect(body.sections[1].questions).toHaveLength(1); // sec-2 has q-2
  });

  // ── Empty state ─────────────────────────────────────────────────────

  it('should return empty sections when no questions exist', async () => {
    // loadQuestions — empty
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    // loadAnswers — empty
    mockSend.mockResolvedValueOnce({
      Items: [],
      LastEvaluatedKey: undefined,
    });

    const result = await baseHandler(makeEvent('proj-empty')) as LambdaResponse;
    const body = parseBody(result);

    expect(result.statusCode).toBe(200);
    expect(body.sections).toHaveLength(0);
    expect(body.answers).toEqual({});
  });

  // ── Batch loading (regression for N+1) ──────────────────────────────

  it('should make exactly 2 DynamoDB queries (not N+1)', async () => {
    // loadQuestions
    mockSend.mockResolvedValueOnce({
      Items: [
        { questionId: 'q-1', question: 'Q1', sectionId: 's1', sectionTitle: 'S1' },
        { questionId: 'q-2', question: 'Q2', sectionId: 's1', sectionTitle: 'S1' },
        { questionId: 'q-3', question: 'Q3', sectionId: 's1', sectionTitle: 'S1' },
      ],
      LastEvaluatedKey: undefined,
    });

    // loadAnswers
    mockSend.mockResolvedValueOnce({
      Items: [
        { questionId: 'q-1', text: 'A1', sources: [], createdAt: '2026-01-01T00:00:00Z' },
        { questionId: 'q-2', text: 'A2', sources: [], createdAt: '2026-01-01T00:00:00Z' },
      ],
      LastEvaluatedKey: undefined,
    });

    await baseHandler(makeEvent('proj-1')) as LambdaResponse;

    // Critical regression check: exactly 2 queries, not N+1
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  // ── Pagination ──────────────────────────────────────────────────────

  it('should handle DynamoDB pagination for questions', async () => {
    // Promise.all runs loadQuestions and loadAnswers concurrently.
    // loadQuestions page 1 and loadAnswers page 1 start simultaneously.
    // Mock call order: 1=loadQuestions page1, 2=loadAnswers page1, 3=loadQuestions page2
    mockSend
      .mockResolvedValueOnce({
        // loadQuestions — page 1
        Items: [
          { questionId: 'q-1', question: 'Q1', sectionId: 's1', sectionTitle: 'S1' },
        ],
        LastEvaluatedKey: { pk: 'QUESTION', sk: 'proj-1#s1#q-1' },
      })
      .mockResolvedValueOnce({
        // loadAnswers — single page (runs concurrently)
        Items: [],
        LastEvaluatedKey: undefined,
      })
      .mockResolvedValueOnce({
        // loadQuestions — page 2 (continuation after page 1)
        Items: [
          { questionId: 'q-2', question: 'Q2', sectionId: 's1', sectionTitle: 'S1' },
        ],
        LastEvaluatedKey: undefined,
      });

    const result = await baseHandler(makeEvent('proj-1')) as LambdaResponse;
    const body = parseBody(result);

    expect(result.statusCode).toBe(200);
    // Total questions across both pages
    const totalQuestions = body.sections.flatMap((s: { questions: unknown[] }) => s.questions).length;
    expect(totalQuestions).toBe(2);
    // 3 calls total: 2 for paginated questions + 1 for answers
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  // ── Answer deduplication ────────────────────────────────────────────

  it('should keep the most recent answer when duplicates exist', async () => {
    // loadQuestions
    mockSend.mockResolvedValueOnce({
      Items: [
        { questionId: 'q-1', question: 'Q1', sectionId: 's1', sectionTitle: 'S1' },
      ],
      LastEvaluatedKey: undefined,
    });

    // loadAnswers — two answers for same question
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          questionId: 'q-1',
          text: 'Old answer',
          sources: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
        {
          questionId: 'q-1',
          text: 'New answer',
          sources: [],
          createdAt: '2026-03-01T00:00:00Z',
          updatedAt: '2026-03-01T00:00:00Z',
        },
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await baseHandler(makeEvent('proj-1')) as LambdaResponse;
    const body = parseBody(result);

    expect(body.answers['q-1'].text).toBe('New answer');
    expect(body.sections[0].questions[0].answer).toBe('New answer');
  });

  // ── Source content stripping ────────────────────────────────────────

  it('should strip textContent from answer sources to reduce payload', async () => {
    // loadQuestions
    mockSend.mockResolvedValueOnce({
      Items: [
        { questionId: 'q-1', question: 'Q1', sectionId: 's1', sectionTitle: 'S1' },
      ],
      LastEvaluatedKey: undefined,
    });

    // loadAnswers — answer with source containing textContent
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          questionId: 'q-1',
          text: 'Answer with sources',
          sources: [
            {
              documentId: 'doc-1',
              documentTitle: 'RFP Document',
              textContent: 'This is a very long text content that should be stripped...',
              score: 0.95,
            },
          ],
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await baseHandler(makeEvent('proj-1')) as LambdaResponse;
    const body = parseBody(result);

    const source = body.answers['q-1'].sources[0];
    expect(source.documentId).toBe('doc-1');
    expect(source.documentTitle).toBe('RFP Document');
    expect(source.score).toBe(0.95);
    // textContent should be stripped
    expect(source.textContent).toBeUndefined();
  });

  // ── Error handling ──────────────────────────────────────────────────

  it('should return 500 when DynamoDB query fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB connection timeout'));

    const result = await baseHandler(makeEvent('proj-1')) as LambdaResponse;

    expect(result.statusCode).toBe(500);
    expect(parseBody(result).message).toBe('Internal error');
  });
});
