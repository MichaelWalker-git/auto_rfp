/**
 * Tests for generate-answer resolution recording.
 *
 * Focus: every path that produces no usable answer must persist a REASON
 * (NO_KB_MATCH / GENERATION_FAILED) so the question is never a silent blank.
 */

// Mock middy before importing handlers (ESM compatibility)
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

// Sentry: run the wrapped callback inline so spans don't change behavior
jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
  Sentry: {
    startSpan: (_opts: unknown, cb: () => unknown) => cb(),
  },
}));

// RBAC + audit middleware are no-ops here — we test the business function directly
jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({}),
  httpErrorMiddleware: () => ({}),
  orgMembershipMiddleware: () => ({}),
  requirePermission: () => ({}),
}));
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ before: jest.fn(), after: jest.fn() })),
  setAuditContext: jest.fn(),
}));

// saveAnswer is the boundary we assert against — capture every call
const mockSaveAnswer = jest.fn();
jest.mock('./save-answer', () => ({
  saveAnswer: mockSaveAnswer,
}));

// Generation boundaries
const mockGetEmbedding = jest.fn();
jest.mock('@/helpers/embeddings', () => ({
  getEmbedding: mockGetEmbedding,
}));

const mockSemanticSearchContentLibrary = jest.fn();
jest.mock('@/helpers/semantic-search', () => ({
  semanticSearchContentLibrary: mockSemanticSearchContentLibrary,
}));

const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: mockInvokeModel,
}));

const mockSafeParseJsonFromModel = jest.fn();
jest.mock('@/helpers/json', () => ({
  safeParseJsonFromModel: mockSafeParseJsonFromModel,
}));

// Mock answer-tools so its module-level requireEnv('DOCUMENTS_BUCKET') and
// transitive AWS imports never load. invokeModel returns end_turn immediately,
// so executeAnswerTool is never actually called in these tests.
jest.mock('@/helpers/answer-tools', () => ({
  ANSWER_TOOLS: [],
  executeAnswerTool: jest.fn(),
}));

jest.mock('@/helpers/question', () => ({
  getQuestionItemById: jest.fn(),
}));
jest.mock('@/helpers/db', () => ({
  getItem: jest.fn(),
}));
jest.mock('@/helpers/confidence-score', () => ({
  calculateConfidenceScore: jest.fn(() => ({
    overall: 80,
    band: 'medium',
    breakdown: { contextRelevance: 80, sourceRecency: 80, answerCoverage: 80, sourceAuthority: 80, consistency: 80 },
  })),
}));
jest.mock('@/helpers/usage-tracking', () => ({
  trackContentLibraryUsage: jest.fn(() => Promise.resolve()),
}));
jest.mock('@/constants/prompt', () => ({
  getAnswerSystemPrompt: jest.fn(() => Promise.resolve('system prompt')),
  useAnswerUserPrompt: jest.fn(() => Promise.resolve('user prompt')),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.BEDROCK_MODEL_ID = 'test-model';

import { generateAnswerForQuestion } from './generate-answer';

/** Encode a Bedrock response the way invokeModel returns it (raw bytes). */
const bedrockResponse = (body: unknown): Buffer => Buffer.from(JSON.stringify(body));

describe('generateAnswerForQuestion — resolution recording', () => {
  const baseParams = {
    questionId: 'q-123',
    projectId: 'proj-456',
    orgId: 'org-789',
    opportunityId: 'opp-001',
    questionFileId: 'file-1',
    questionText: 'Describe your transition services.',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveAnswer.mockResolvedValue({ id: 'ans-1' });
    mockGetEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
    // No content-library match by default → falls through to tool generation
    mockSemanticSearchContentLibrary.mockResolvedValue([]);
    mockSafeParseJsonFromModel.mockReturnValue({});
  });

  it('records NO_KB_MATCH (skipIfAnswered) when the model returns no text', async () => {
    // end_turn with empty text → generateAnswerWithTools returns an empty answer
    mockInvokeModel.mockResolvedValue(
      bedrockResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: '' }] }),
    );

    const result = await generateAnswerForQuestion(baseParams);

    expect(result.resolution).toBe('NO_KB_MATCH');
    expect(result.found).toBe(false);
    expect(result.answer).toBe('');

    expect(mockSaveAnswer).toHaveBeenCalledTimes(1);
    const saved = mockSaveAnswer.mock.calls[0][0];
    expect(saved.resolution).toBe('NO_KB_MATCH');
    expect(saved.text).toBe('');
    expect(saved.skipIfAnswered).toBe(true);
  });

  it('records NO_KB_MATCH when the model claims found=true but returns empty text', async () => {
    // The model sometimes self-reports found=true with an empty answer — this must
    // NOT be persisted as a blank "ANSWERED" answer.
    mockInvokeModel.mockResolvedValue(
      bedrockResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"answer":"","found":true}' }] }),
    );
    mockSafeParseJsonFromModel.mockReturnValue({ answer: '', found: true, confidence: 0.8 });

    const result = await generateAnswerForQuestion(baseParams);

    expect(result.resolution).toBe('NO_KB_MATCH');
    const saved = mockSaveAnswer.mock.calls[0][0];
    expect(saved.resolution).toBe('NO_KB_MATCH');
    expect(saved.skipIfAnswered).toBe(true);
  });

  it('records GENERATION_FAILED and re-throws when generation throws', async () => {
    mockGetEmbedding.mockRejectedValueOnce(new Error('Pinecone unavailable'));

    await expect(generateAnswerForQuestion(baseParams)).rejects.toThrow('Pinecone unavailable');

    expect(mockSaveAnswer).toHaveBeenCalledTimes(1);
    const saved = mockSaveAnswer.mock.calls[0][0];
    expect(saved.resolution).toBe('GENERATION_FAILED');
    expect(saved.text).toBe('');
    expect(saved.skipIfAnswered).toBe(true);
    expect(saved.questionId).toBe('q-123');
  });

  it('records AI_NOT_CONFIGURED (not GENERATION_FAILED) when the org has no Bedrock key', async () => {
    const { AiNotConfiguredError } = jest.requireActual('@/helpers/ai-config-error');
    mockGetEmbedding.mockRejectedValueOnce(new AiNotConfiguredError('org-789'));

    await expect(generateAnswerForQuestion(baseParams)).rejects.toBeInstanceOf(AiNotConfiguredError);

    expect(mockSaveAnswer).toHaveBeenCalledTimes(1);
    const saved = mockSaveAnswer.mock.calls[0][0];
    expect(saved.resolution).toBe('AI_NOT_CONFIGURED');
    expect(saved.text).toBe('');
    expect(saved.skipIfAnswered).toBe(true);
  });

  it('re-throws the ORIGINAL error even if recording the resolution also fails', async () => {
    mockGetEmbedding.mockRejectedValueOnce(new Error('Bedrock timeout'));
    mockSaveAnswer.mockRejectedValueOnce(new Error('DynamoDB unreachable'));

    // The root-cause error is surfaced, not the bookkeeping failure
    await expect(generateAnswerForQuestion(baseParams)).rejects.toThrow('Bedrock timeout');
  });

  it('records ANSWERED with the answer text on the happy path', async () => {
    mockInvokeModel.mockResolvedValue(
      bedrockResponse({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"answer":"Our transition plan...","found":true,"confidence":0.9}' }] }),
    );
    mockSafeParseJsonFromModel.mockReturnValue({ answer: 'Our transition plan...', found: true, confidence: 0.9 });

    const result = await generateAnswerForQuestion(baseParams);

    expect(result.resolution).toBe('ANSWERED');
    expect(result.answer).toBe('Our transition plan...');
    const saved = mockSaveAnswer.mock.calls[0][0];
    expect(saved.resolution).toBe('ANSWERED');
    expect(saved.text).toBe('Our transition plan...');
    // The success path must NOT pass skipIfAnswered — a real answer always writes
    expect(saved.skipIfAnswered).toBeUndefined();

    // orgId propagates to both Bedrock seams (per-org Bedrock key).
    expect(mockGetEmbedding).toHaveBeenCalledWith(expect.anything(), 'org-789');
    expect(mockInvokeModel).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'org-789',
    );
  });
});
