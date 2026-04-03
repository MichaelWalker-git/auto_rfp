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

const makeEvent = (projectId?: string, queryParams?: Record<string, string>): APIGatewayProxyEventV2 =>
  ({
    pathParameters: projectId ? { projectId } : {},
    queryStringParameters: queryParams ?? {},
    headers: {},
    body: null,
  }) as unknown as APIGatewayProxyEventV2;

/** Shorthand: makeEvent with opportunityId included (most tests need it) */
const makeEventWithOpp = (projectId: string, opportunityId = 'opp-1', extra?: Record<string, string>) =>
  makeEvent(projectId, { opportunityId, ...extra });

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

    const result = await baseHandler(makeEventWithOpp('proj-1')) as LambdaResponse;

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

    const result = await baseHandler(makeEventWithOpp('proj-1')) as LambdaResponse;
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

    const result = await baseHandler(makeEventWithOpp('proj-empty')) as LambdaResponse;
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

    await baseHandler(makeEventWithOpp('proj-1')) as LambdaResponse;

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

    const result = await baseHandler(makeEventWithOpp('proj-1')) as LambdaResponse;
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

    const result = await baseHandler(makeEventWithOpp('proj-1')) as LambdaResponse;
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

    const result = await baseHandler(makeEventWithOpp('proj-1')) as LambdaResponse;
    const body = parseBody(result);

    const source = body.answers['q-1'].sources[0];
    expect(source.documentId).toBe('doc-1');
    expect(source.documentTitle).toBe('RFP Document');
    expect(source.score).toBe(0.95);
    // textContent should be stripped
    expect(source.textContent).toBeUndefined();
  });

  // ── OpportunityId filter ───────────────────────────────────────────

  it('should filter questions by opportunityId when provided', async () => {
    // loadQuestions — returns only opp-1 questions (FilterExpression applied by DynamoDB)
    mockSend.mockResolvedValueOnce({
      Items: [
        { questionId: 'q-1', question: 'Q1', sectionId: 's1', sectionTitle: 'S1', opportunityId: 'opp-1' },
        { questionId: 'q-2', question: 'Q2', sectionId: 's1', sectionTitle: 'S1', opportunityId: 'opp-1' },
      ],
      LastEvaluatedKey: undefined,
    });

    // loadAnswers — returns ALL answers for the project (no filter at DB level)
    mockSend.mockResolvedValueOnce({
      Items: [
        { questionId: 'q-1', text: 'A1', sources: [], createdAt: '2026-01-01T00:00:00Z' },
        { questionId: 'q-2', text: 'A2', sources: [], createdAt: '2026-01-01T00:00:00Z' },
        { questionId: 'q-other', text: 'Other opp answer', sources: [], createdAt: '2026-01-01T00:00:00Z' },
      ],
      LastEvaluatedKey: undefined,
    });

    const result = await baseHandler(makeEvent('proj-1', { opportunityId: 'opp-1' })) as LambdaResponse;
    const body = parseBody(result);

    expect(result.statusCode).toBe(200);
    // Only 2 questions for opp-1
    const allQuestions = body.sections.flatMap((s: { questions: unknown[] }) => s.questions);
    expect(allQuestions).toHaveLength(2);
    // Answers map only contains answers for the filtered questions, not q-other
    expect(body.answers['q-1']).toBeDefined();
    expect(body.answers['q-2']).toBeDefined();
    expect(body.answers['q-other']).toBeUndefined();
  });

  it('should pass FilterExpression to DynamoDB when opportunityId is provided', async () => {
    const { QueryCommand } = jest.requireMock('@aws-sdk/lib-dynamodb');

    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });
    mockSend.mockResolvedValueOnce({ Items: [], LastEvaluatedKey: undefined });

    await baseHandler(makeEvent('proj-1', { opportunityId: 'opp-123' })) as LambdaResponse;

    // First call is loadQuestions — should include FilterExpression
    const questionsQuery = QueryCommand.mock.calls[0][0];
    expect(questionsQuery.FilterExpression).toBe('#oppId = :oppId');
    expect(questionsQuery.ExpressionAttributeNames['#oppId']).toBe('opportunityId');
    expect(questionsQuery.ExpressionAttributeValues[':oppId']).toBe('opp-123');
  });

  it('should return 400 when opportunityId is not provided', async () => {
    const result = await baseHandler(makeEvent('proj-1')) as LambdaResponse;

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).message).toBe('opportunityId query parameter is required');
    expect(mockSend).not.toHaveBeenCalled();
  });

  // ── Payload size limit ─────────────────────────────────────────────

  it('should return 400 when loading all questions without opportunityId (prevents 6MB overflow)', async () => {
    // Previously this would load all 3100 questions and exceed the 6MB Lambda limit.
    // Now it returns 400 immediately without hitting DynamoDB.
    const result = await baseHandler(makeEvent('proj-large')) as LambdaResponse;

    expect(result.statusCode).toBe(400);
    expect(parseBody(result).message).toBe('opportunityId query parameter is required');
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('should stay under 6MB when filtering by opportunityId on a large project', async () => {
    // Same large dataset as above (3100 questions across 27 opportunities),
    // but filtered to a single opportunity (~115 questions).
    const questionCount = 3100;
    const targetOpportunity = 'opp-0';
    const answerText = 'Our team has extensive experience implementing compliance controls. '.repeat(8);

    // DynamoDB FilterExpression runs server-side, so loadQuestions only returns
    // questions matching the opportunityId. Simulate that here.
    const allQuestions = Array.from({ length: questionCount }, (_: unknown, i: number) => ({
      questionId: `q-${i}`,
      question: `Question ${i}: ${'Describe your approach to compliance with the prohibitions outlined in the contract. '.repeat(3)}`,
      sectionId: `sec-${i % 10}`,
      sectionTitle: `Section ${i % 10}`,
      sectionDescription: `Description for section ${i % 10}`,
      opportunityId: `opp-${i % 27}`,
      questionFileId: `file-${i % 87}`,
    }));
    const filteredQuestions = allQuestions.filter((q) => q.opportunityId === targetOpportunity);

    // All answers for the project (loadAnswers doesn't filter by opportunity)
    const allAnswers = Array.from({ length: questionCount }, (_: unknown, i: number) => ({
      questionId: `q-${i}`,
      text: answerText,
      confidence: 0.85,
      confidenceBand: 'HIGH',
      status: 'approved',
      updatedBy: 'user-123',
      updatedByName: 'John Smith',
      approvedBy: 'user-456',
      approvedByName: 'Jane Doe',
      approvedAt: '2026-03-15T00:00:00Z',
      sources: [
        { documentId: `doc-${i}`, documentTitle: `RFP Document ${i}`, chunkIndex: 0, score: 0.95, textContent: 'Stripped' },
        { documentId: `doc-${i}-2`, documentTitle: `Past Performance Report ${i}`, chunkIndex: 1, score: 0.87, textContent: 'Stripped' },
        { documentId: `doc-${i}-3`, documentTitle: `Technical Volume ${i}`, chunkIndex: 2, score: 0.79, textContent: 'Stripped' },
      ],
      createdAt: '2026-03-01T00:00:00Z',
      updatedAt: '2026-03-15T00:00:00Z',
    }));

    // loadQuestions — only the filtered questions (DynamoDB applies FilterExpression)
    mockSend.mockResolvedValueOnce({
      Items: filteredQuestions,
      LastEvaluatedKey: undefined,
    });

    // loadAnswers — all answers for the project
    mockSend.mockResolvedValueOnce({
      Items: allAnswers,
      LastEvaluatedKey: undefined,
    });

    const result = await baseHandler(makeEvent('proj-large', { opportunityId: targetOpportunity })) as LambdaResponse;

    expect(result.statusCode).toBe(200);

    const body = parseBody(result);
    const returnedQuestions = body.sections.flatMap((s: { questions: unknown[] }) => s.questions);
    const returnedAnswerCount = Object.keys(body.answers).length;

    const bodySize = Buffer.byteLength(result.body, 'utf8');
    const lambdaResponseLimit = 6_291_556;

    console.log(`[payload-fix-test] Filtered questions: ${returnedQuestions.length} (from ${questionCount} total)`);
    console.log(`[payload-fix-test] Filtered answers: ${returnedAnswerCount} (from ${questionCount} total)`);
    console.log(`[payload-fix-test] Response body size: ${(bodySize / 1024 / 1024).toFixed(2)} MB (${bodySize.toLocaleString()} bytes)`);
    console.log(`[payload-fix-test] Lambda limit: ${(lambdaResponseLimit / 1024 / 1024).toFixed(2)} MB`);

    // Only ~115 questions for one opportunity out of 27
    expect(returnedQuestions.length).toBeLessThan(200);
    // Answers are filtered to only those matching the returned questions
    expect(returnedAnswerCount).toBe(returnedQuestions.length);
    // Response is well under the 6MB limit
    expect(bodySize).toBeLessThan(lambdaResponseLimit);
  });

  // ── Error handling ──────────────────────────────────────────────────

  it('should return 500 when DynamoDB query fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('DynamoDB connection timeout'));

    const result = await baseHandler(makeEventWithOpp('proj-1')) as LambdaResponse;

    expect(result.statusCode).toBe(500);
    expect(parseBody(result).message).toBe('Internal error');
  });
});
