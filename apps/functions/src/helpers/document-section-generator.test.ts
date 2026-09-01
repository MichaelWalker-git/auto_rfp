/**
 * Focused orgId-propagation test for the section-by-section generator: the
 * caller-supplied orgId must reach every invokeModel call (per-org Bedrock key).
 */
const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: (...a: unknown[]) => mockInvokeModel(...a),
}));

jest.mock('@/helpers/document-tools', () => ({
  getDocumentToolsForType: () => [],
  executeDocumentTool: jest.fn(),
}));

import { generateDocumentSectionBySectionHtml } from './document-section-generator';
import type { GenerateSectionBySection } from './document-section-generator';

/** Encode a Bedrock end_turn response whose text content is the given HTML. */
const bedrockResponse = (html: string): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: html }] }),
  );

const baseArgs = (orgId: string): GenerateSectionBySection => ({
  modelId: 'test-model',
  systemPrompt: 'system',
  initialUserPrompt: 'context',
  sections: [{ title: 'Approach' }],
  documentType: 'TECHNICAL_PROPOSAL',
  orgId,
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  documentId: 'doc-1',
  qaPairs: [],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockInvokeModel.mockResolvedValue(bedrockResponse('<h2>Approach</h2><p>Body</p>'));
});

describe('generateDocumentSectionBySectionHtml — orgId propagation', () => {
  it('threads orgId through to invokeModel as the third argument', async () => {
    const fragments = await generateDocumentSectionBySectionHtml(baseArgs('the-org-id'));

    expect(fragments).toHaveLength(1);
    expect(mockInvokeModel).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'the-org-id',
    );
  });
});
