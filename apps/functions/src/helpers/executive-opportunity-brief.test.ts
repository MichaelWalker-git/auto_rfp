/**
 * Focused orgId-propagation tests for the executive-opportunity-brief Bedrock
 * seams: invokeClaudeJson and queryCompanyKnowledgeBase must forward the
 * caller's orgId to the Bedrock HTTP client (per-org Bedrock key).
 */
const mockInvokeModel = jest.fn();
jest.mock('./bedrock-http-client', () => ({
  invokeModel: (...a: unknown[]) => mockInvokeModel(...a),
}));

const mockGetEmbedding = jest.fn();
jest.mock('helpers/embeddings', () => ({
  getEmbedding: (...a: unknown[]) => mockGetEmbedding(...a),
}));

const mockSemanticSearchChunks = jest.fn();
jest.mock('./semantic-search', () => ({
  semanticSearchChunks: (...a: unknown[]) => mockSemanticSearchChunks(...a),
}));

const mockDocClientSend = jest.fn();
jest.mock('./db', () => ({
  docClient: { send: (...a: unknown[]) => mockDocClientSend(...a) },
  getItem: jest.fn(),
}));

const mockLoadTextFromS3 = jest.fn();
jest.mock('./s3', () => ({
  loadTextFromS3: (...a: unknown[]) => mockLoadTextFromS3(...a),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.DOCUMENTS_BUCKET = 'test-bucket';

import { z } from 'zod';
import {
  applyPerDocumentBudget,
  invokeClaudeJson,
  loadAllSolicitationTexts,
  MIN_PER_DOC_CHARS,
  queryCompanyKnowledgeBase,
} from './executive-opportunity-brief';

const bedrockResponse = (payload: unknown): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(payload) }] }),
  );

beforeEach(() => {
  jest.clearAllMocks();
});

describe('invokeClaudeJson — orgId propagation', () => {
  it('threads orgId through to invokeModel as the third argument', async () => {
    mockInvokeModel.mockResolvedValue(bedrockResponse({ ok: true }));

    await invokeClaudeJson({
      modelId: 'test-model',
      system: 'system',
      user: 'user',
      outputSchema: z.object({ ok: z.boolean() }),
      orgId: 'the-org-id',
    });

    expect(mockInvokeModel).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'the-org-id',
    );
  });
});

describe('queryCompanyKnowledgeBase — orgId propagation', () => {
  it('threads orgId through to getEmbedding as the second argument', async () => {
    mockGetEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
    mockSemanticSearchChunks.mockResolvedValue([]);

    await queryCompanyKnowledgeBase('the-org-id', 'solicitation text', 4);

    expect(mockGetEmbedding).toHaveBeenCalledWith('solicitation text', 'the-org-id');
  });
});

// ─── Layer 0 — per-document budget floor (docs/SOLICITATION-COVERAGE-PLAN.md) ──

const doc = (fileName: string, chars: number) => ({ fileName, text: 'x'.repeat(chars) });

describe('applyPerDocumentBudget', () => {
  it('keeps every document under a tight per-file budget instead of dropping the oldest ones', () => {
    const docs = Array.from({ length: 6 }, (_, i) => doc(`Doc${i}.pdf`, 25_000));

    const budgeted = applyPerDocumentBudget(docs, 80_000);

    expect(budgeted).toHaveLength(6);
    for (const b of budgeted) {
      expect(b.text.length).toBeGreaterThan(0);
      expect(b.text.length).toBeLessThanOrEqual(Math.floor(80_000 / 6));
    }
    expect(budgeted.reduce((sum, b) => sum + b.text.length, 0)).toBeLessThanOrEqual(80_000);
  });

  it('returns documents untouched when the total is already within budget', () => {
    const docs = [doc('A.pdf', 1_000), doc('B.pdf', 2_000)];

    const budgeted = applyPerDocumentBudget(docs, 80_000);

    expect(budgeted).toEqual([
      { fileName: 'A.pdf', text: docs[0]!.text, trimmedBy: 0 },
      { fileName: 'B.pdf', text: docs[1]!.text, trimmedBy: 0 },
    ]);
  });

  it('round-robins trimming across many documents when the per-document floor still exceeds maxChars', () => {
    const docs = Array.from({ length: 20 }, (_, i) => doc(`Doc${i}.pdf`, 50_000));

    const budgeted = applyPerDocumentBudget(docs, 50_000);

    // All 20 documents survive — none dropped outright, unlike a flat slice(0, maxChars).
    expect(budgeted).toHaveLength(20);
    expect(budgeted.every((b) => b.text.length >= 0)).toBe(true);
    // The floor (MIN_PER_DOC_CHARS=3,000 × 20 = 60,000) exceeds maxChars (50,000), so
    // round-robin trimming below the floor is expected here to fit the budget.
    expect(budgeted.reduce((sum, b) => sum + b.text.length, 0)).toBeLessThanOrEqual(50_000);
    expect(budgeted.some((b) => b.trimmedBy > 0)).toBe(true);
  });

  it('never trims a document below zero chars', () => {
    const docs = Array.from({ length: 50 }, (_, i) => doc(`Doc${i}.pdf`, MIN_PER_DOC_CHARS));

    const budgeted = applyPerDocumentBudget(docs, 1_000);

    expect(budgeted.every((b) => b.text.length >= 0)).toBe(true);
  });
});

describe('loadAllSolicitationTexts — trim logging', () => {
  const questionFileItem = (overrides: Record<string, unknown>) => ({
    projectId: 'proj-1',
    oppId: 'opp-1',
    status: 'EXTRACTED',
    ...overrides,
  });

  it('warns naming every document trimmed to fit the char budget', async () => {
    mockDocClientSend.mockResolvedValue({
      Items: [
        questionFileItem({ questionFileId: 'qf-1', createdAt: '2024-01-01T00:00:00Z', textFileKey: 'key-1', originalFileName: 'Old.pdf' }),
        questionFileItem({ questionFileId: 'qf-2', createdAt: '2024-01-02T00:00:00Z', textFileKey: 'key-2', originalFileName: 'New.pdf' }),
      ],
    });
    mockLoadTextFromS3.mockImplementation(async (_bucket: string, key: string) =>
      key === 'key-1' ? 'a'.repeat(50_000) : 'b'.repeat(50_000),
    );
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await loadAllSolicitationTexts('proj-1', 'opp-1', 80_000);

    const trimWarning = warnSpy.mock.calls.map((c) => c.join(' ')).find((line) => line.includes('Trimmed'));
    expect(trimWarning).toBeDefined();
    expect(trimWarning).toContain('Old.pdf');
    expect(trimWarning).toContain('New.pdf');

    warnSpy.mockRestore();
  });

  it('does not warn when every document fits within the budget', async () => {
    mockDocClientSend.mockResolvedValue({
      Items: [
        questionFileItem({ questionFileId: 'qf-1', createdAt: '2024-01-01T00:00:00Z', textFileKey: 'key-1', originalFileName: 'Small.pdf' }),
      ],
    });
    mockLoadTextFromS3.mockResolvedValue('small text');
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await loadAllSolicitationTexts('proj-1', 'opp-1', 80_000);

    expect(warnSpy.mock.calls.map((c) => c.join(' ')).some((line) => line.includes('Trimmed'))).toBe(false);

    warnSpy.mockRestore();
  });
});
