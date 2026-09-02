const mockLoadHtml = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  loadRFPDocumentHtml: (...a: unknown[]) => mockLoadHtml(...a),
}));

const mockGetLinkedKBIds = jest.fn();
jest.mock('@/helpers/project-kb', () => ({
  getLinkedKBIds: (...a: unknown[]) => mockGetLinkedKBIds(...a),
}));

const mockSearchKB = jest.fn();
jest.mock('@/helpers/compliance-truth-sources', () => ({
  searchKnowledgeBase: (...a: unknown[]) => mockSearchKB(...a),
}));

const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: (...a: unknown[]) => mockInvokeModel(...a),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { computeKbContradictionFindings } from './compliance-review-kb-contradiction';
import type { PackageInventory } from '@/helpers/compliance-review-tools';

const modelReply = (obj: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }] }));

const kbHit = (over: Record<string, unknown> = {}) => ({
  itemId: 'kb-1',
  question: 'Do you offer 24/7 support?',
  answer: 'Yes, we provide 24/7 support.',
  category: 'Support',
  score: 0.9,
  ...over,
});

const inv = (over: Partial<PackageInventory['documents'][number]> = {}): PackageInventory => ({
  documents: [
    {
      documentId: 'd1',
      title: 'Technical Volume',
      targetKind: 'RFP_DOCUMENT',
      headings: ['Support Model'],
      htmlContentKey: 'key-d1',
      ...over,
    },
  ],
  forms: [],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLinkedKBIds.mockResolvedValue([]);
});

describe('computeKbContradictionFindings', () => {
  it('returns [] when there are no HTML docs', async () => {
    const inventory: PackageInventory = {
      documents: [
        { documentId: 'q1', title: 'Q', targetKind: 'XLSX_QUESTIONNAIRE', headings: [] },
      ],
      forms: [],
    };
    expect(await computeKbContradictionFindings({ orgId: 'o', projectId: 'p', modelId: 'm', inventory })).toEqual([]);
    expect(mockLoadHtml).not.toHaveBeenCalled();
  });

  it('flags a section that contradicts an approved KB answer, anchored to the real heading', async () => {
    mockLoadHtml.mockResolvedValue(
      '<h2>Support Model</h2><p>We do not offer 24/7 support under this contract.</p>',
    );
    mockSearchKB.mockResolvedValue([kbHit()]);
    mockInvokeModel.mockResolvedValue(
      modelReply({
        contradictions: [
          { index: 0, verbatimSnippet: 'We do not offer 24/7 support', why: 'KB says 24/7 is offered' },
        ],
      }),
    );

    const findings = await computeKbContradictionFindings({ orgId: 'o', projectId: 'p', modelId: 'm', inventory: inv() });
    expect(findings).toHaveLength(1);
    expect(findings[0].issueType).toBe('FACTUAL_INACCURACY');
    expect(findings[0].severity).toBe('major');
    // The heading comes from CODE, not the model echo.
    expect(findings[0].anchor).toEqual({ kind: 'heading', text: 'Support Model' });
    expect(findings[0].snippet).toContain('We do not offer 24/7 support');
    // orgId threads through to the Bedrock contradiction-check call as the 3rd arg.
    expect(mockInvokeModel).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'o');
  });

  it('skips sections with no surviving (gated) KB hit — no model call', async () => {
    mockLoadHtml.mockResolvedValue('<h2>Support Model</h2><p>Standard support.</p>');
    mockSearchKB.mockResolvedValue([]); // gate filtered everything out
    const findings = await computeKbContradictionFindings({ orgId: 'o', projectId: 'p', modelId: 'm', inventory: inv() });
    expect(findings).toEqual([]);
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('degrades a heading-less document to a snippet-only finding (no anchor)', async () => {
    mockLoadHtml.mockResolvedValue('<p>We do not offer 24/7 support.</p>');
    mockSearchKB.mockResolvedValue([kbHit()]);
    mockInvokeModel.mockResolvedValue(
      modelReply({ contradictions: [{ index: 0, verbatimSnippet: 'We do not offer 24/7 support', why: 'x' }] }),
    );

    const findings = await computeKbContradictionFindings({
      orgId: 'o',
      projectId: 'p',
      modelId: 'm',
      inventory: inv({ headings: [] }),
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].anchor).toBeUndefined();
    expect(findings[0].snippet).toContain('We do not offer 24/7 support');
  });

  it('fails open to [] when the model call throws', async () => {
    mockLoadHtml.mockResolvedValue('<h2>Support Model</h2><p>text</p>');
    mockSearchKB.mockResolvedValue([kbHit()]);
    mockInvokeModel.mockRejectedValue(new Error('bedrock down'));
    const findings = await computeKbContradictionFindings({ orgId: 'o', projectId: 'p', modelId: 'm', inventory: inv() });
    expect(findings).toEqual([]);
  });

  it('caps KB retrieval at MAX_FACTUAL_CANDIDATES_PER_CHECK sections BEFORE querying', async () => {
    // A doc with far more sections than the cap: one <h2>+<p> pair per section.
    const bigHtml = Array.from({ length: 200 }, (_, i) => `<h2>H${i}</h2><p>Body ${i}.</p>`).join('');
    mockLoadHtml.mockResolvedValue(bigHtml);
    mockSearchKB.mockResolvedValue([]); // no hits → no model call, isolates retrieval count

    await computeKbContradictionFindings({ orgId: 'o', projectId: 'p', modelId: 'm', inventory: inv() });

    // searchKnowledgeBase (embedding + Pinecone) must fire at most once per capped
    // section — never once per raw section. 60 is MAX_FACTUAL_CANDIDATES_PER_CHECK.
    expect(mockSearchKB.mock.calls.length).toBe(60);
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('scopes KB search to linked KB ids when the project has them', async () => {
    mockGetLinkedKBIds.mockResolvedValue(['kb-A', 'kb-B']);
    mockLoadHtml.mockResolvedValue('<h2>Support Model</h2><p>text</p>');
    mockSearchKB.mockResolvedValue([]);
    await computeKbContradictionFindings({ orgId: 'o', projectId: 'p', modelId: 'm', inventory: inv() });
    // 4th arg to searchKnowledgeBase is the scoped kbIds.
    expect(mockSearchKB).toHaveBeenCalledWith('o', expect.any(String), expect.any(Number), ['kb-A', 'kb-B']);
  });
});
