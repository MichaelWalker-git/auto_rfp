/**
 * Tests for the deterministic template-resilience helpers in the RFP document
 * generation worker:
 *   - ensureDocumentTitleHeading — guarantees a document-type <h1> title
 *   - assessTemplateHealth — flags templates that can't produce content
 *
 * These guard against malformed templates (no <h1>, no {{CONTENT}} placeholder)
 * combined with an empty knowledge base, which previously produced wrong titles,
 * missing title pages, and permanently-failed generations.
 */

// Mock dependencies BEFORE imports
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});
jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: jest.fn((handler: unknown) => handler),
}));
jest.mock('@/helpers/json', () => ({ safeParseJsonFromModel: jest.fn() }));
jest.mock('@/helpers/document-context', () => ({ gatherAllContext: jest.fn() }));
jest.mock('@/helpers/document-prompts', () => ({
  buildSystemPromptForDocumentType: jest.fn(),
  buildSectionSystemPrompt: jest.fn(),
  buildUserPromptForDocumentType: jest.fn(),
}));
jest.mock('@/helpers/document-generation', () => ({
  extractBedrockText: jest.fn(),
  loadQaPairs: jest.fn(),
  loadSolicitation: jest.fn(),
  resolveTemplateHtml: jest.fn(),
  buildMacroValues: jest.fn(),
  validateGeneratedContent: jest.requireActual('@/helpers/document-generation').validateGeneratedContent,
}));
jest.mock('@/helpers/template', () => ({
  getTemplate: jest.fn(),
  findBestTemplate: jest.fn(),
  loadTemplateHtml: jest.fn(),
  replaceMacros: jest.fn(),
}));
jest.mock('@/helpers/rfp-document', () => ({
  uploadRFPDocumentHtml: jest.fn(),
  updateRFPDocumentMetadata: jest.fn(),
  getRFPDocument: jest.fn(),
}));
jest.mock('@/helpers/rfp-document-version', () => ({
  createVersion: jest.fn(),
  getLatestVersionNumber: jest.fn(),
  saveVersionHtml: jest.fn(),
}));
jest.mock('@/helpers/document-tools', () => ({
  DOCUMENT_TOOLS: [],
  executeDocumentTool: jest.fn(),
}));
jest.mock('@/helpers/bedrock-http-client', () => ({ invokeModel: jest.fn() }));
// Use the REAL buildDocumentTitleHtml so the injected title reflects template styling.
jest.mock('@/helpers/document-section-generator', () => ({
  generateDocumentSectionBySectionHtml: jest.fn(),
  buildDocumentTitleHtml: jest.requireActual('@/helpers/document-section-generator').buildDocumentTitleHtml,
}));

process.env.STAGE = 'test';
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import {
  ensureDocumentTitleHeading,
  assessTemplateHealth,
  generateWithTemplateSections,
} from './generate-document-worker';
import { generateDocumentSectionBySectionHtml } from './document-section-generator';

const mockSectionGen = generateDocumentSectionBySectionHtml as jest.MockedFunction<
  typeof generateDocumentSectionBySectionHtml
>;

describe('generateWithTemplateSections — empty-output fallback', () => {
  const baseArgs = {
    systemPrompt: 'sys',
    sectionSystemPrompt: 'section-sys',
    userPrompt: 'user',
    documentType: 'TECHNICAL_PROPOSAL',
    orgId: 'org-1',
    projectId: 'proj-1',
    opportunityId: 'opp-1',
    documentId: 'doc-1',
    qaPairs: [],
  };

  // A template with an <h2> section that has a real [CONTENT:] placeholder, so
  // section-by-section is attempted (rather than short-circuiting to single-shot).
  const templateHtml =
    '<h2>{{PROJECT_TITLE}}</h2><h2>Approach</h2><p>[CONTENT: write the approach]</p>';

  beforeEach(() => jest.clearAllMocks());

  it('returns null (→ single-shot) when stitched sections are near-empty', async () => {
    // Mirrors the empty-KB case: every section falls back to tiny template content.
    mockSectionGen.mockResolvedValue(['<p></p>', '<h2>Approach</h2>']);

    const result = await generateWithTemplateSections({ ...baseArgs, templateHtml });

    expect(result).toBeNull();
  });

  it('returns a document when stitched sections have real content', async () => {
    const realBody = `<h2>Approach</h2><p>${'Our technical approach is comprehensive. '.repeat(10)}</p>`;
    mockSectionGen.mockResolvedValue(['<p>Intro paragraph with substance.</p>', realBody]);

    const result = await generateWithTemplateSections({ ...baseArgs, templateHtml });

    expect(result).not.toBeNull();
    expect(result!.content).toContain('technical approach');
  });
});

describe('ensureDocumentTitleHeading', () => {
  it('injects a document-type <h1> when the content has none', () => {
    const html = '<h2>Acme City Water Project</h2><p>Body content</p>';
    const result = ensureDocumentTitleHeading(html, 'TECHNICAL_PROPOSAL');

    expect(result).toMatch(/^<h1[^>]*>Technical Proposal<\/h1>/);
    expect(result).toContain('<h2>Acme City Water Project</h2>');
  });

  it('leaves content untouched when an <h1> already exists', () => {
    const html = '<h1>Technical Proposal</h1><p>Body</p>';
    expect(ensureDocumentTitleHeading(html, 'TECHNICAL_PROPOSAL')).toBe(html);
  });

  it('reuses the template <h1> style for the injected title', () => {
    const html = '<h2>Project Name</h2><p>Body</p>';
    const templateHtml = '<h1 style="color:rgb(209,139,48);font-size:2em">X</h1>';
    const result = ensureDocumentTitleHeading(html, 'TECHNICAL_PROPOSAL', templateHtml);

    expect(result).toContain('color:rgb(209,139,48);font-size:2em');
  });

  it('returns empty/blank input unchanged', () => {
    expect(ensureDocumentTitleHeading('', 'TECHNICAL_PROPOSAL')).toBe('');
    expect(ensureDocumentTitleHeading('   ', 'TECHNICAL_PROPOSAL')).toBe('   ');
  });
});

describe('assessTemplateHealth', () => {
  it('treats a missing template as ok (default-template path handles it)', () => {
    expect(assessTemplateHealth(null)).toEqual({ ok: true, warnings: [] });
    expect(assessTemplateHealth('')).toEqual({ ok: true, warnings: [] });
  });

  it('passes a well-formed template (h1 + content placeholder)', () => {
    const html = '<h1>Technical Proposal</h1><p>{{CONTENT}}</p>';
    expect(assessTemplateHealth(html)).toEqual({ ok: true, warnings: [] });
  });

  it('passes a sectioned template with an h1 and h2 sections', () => {
    const html = '<h1>Technical Proposal</h1><h2>Summary</h2><p>[CONTENT: x]</p>';
    expect(assessTemplateHealth(html)).toEqual({ ok: true, warnings: [] });
  });

  it('flags a template with no placeholder and no h2 sections', () => {
    // Mirrors the broken dev "Test Tech Proposal" template.
    const html = '<h2>{{PROJECT_TITLE}}</h2><p>{{TODAY}}</p>';
    const { ok, warnings } = assessTemplateHealth(html);

    expect(ok).toBe(false);
    expect(warnings.some(w => w.includes('no {{CONTENT}} placeholder and no fillable sections'))).toBe(true);
    expect(warnings.some(w => w.includes('no <h1> document-type title'))).toBe(true);
  });

  it('flags a missing <h1> even when a content placeholder exists', () => {
    const html = '<h2>Section</h2><p>[CONTENT: write here]</p>';
    const { ok, warnings } = assessTemplateHealth(html);

    expect(ok).toBe(false);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('no <h1> document-type title');
  });
});
