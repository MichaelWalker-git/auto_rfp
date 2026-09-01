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

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { z } from 'zod';
import { invokeClaudeJson, queryCompanyKnowledgeBase } from './executive-opportunity-brief';

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
