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
jest.mock('@/helpers/document-prompt-overrides', () => ({
  resolveDocumentPromptFragments: jest.fn(),
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
  buildMacroValues: jest.fn(),
}));
jest.mock('@/helpers/rfp-document', () => ({
  uploadRFPDocumentHtml: jest.fn(),
  updateRFPDocumentMetadata: jest.fn(),
  getRFPDocument: jest.fn(),
}));
jest.mock('@/helpers/solution-plan', () => ({
  getSolutionPlanByOpportunity: jest.fn(),
  loadSolutionPlanHtml: jest.fn(),
}));
jest.mock('@/helpers/rfp-document-version', () => ({
  createVersion: jest.fn(),
  getLatestVersionNumber: jest.fn(),
  saveVersionHtml: jest.fn(),
}));
jest.mock('@/helpers/document-tools', () => ({
  DOCUMENT_TOOLS: [],
  getDocumentToolsForType: jest.fn(() => []),
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
  applyTemplateStylesToContent,
  extractDocumentTitle,
  loadApprovedSolutionPlanContext,
  processJobInner,
  SOLUTION_PLAN_TEXT_BUDGET,
  type Job,
} from './generate-document-worker';
import { getSolutionPlanByOpportunity, loadSolutionPlanHtml } from './solution-plan';
import { generateDocumentSectionBySectionHtml } from './document-section-generator';
import {
  buildSystemPromptForDocumentType,
  buildSectionSystemPrompt,
  buildUserPromptForDocumentType,
} from './document-prompts';
import { resolveDocumentPromptFragments } from './document-prompt-overrides';
import { safeParseJsonFromModel } from './json';
import { gatherAllContext } from './document-context';
import { loadQaPairs, loadSolicitation, resolveTemplateHtml } from './document-generation';
import { buildMacroValues } from './template';
import { uploadRFPDocumentHtml, updateRFPDocumentMetadata, getRFPDocument } from './rfp-document';
import { getLatestVersionNumber, saveVersionHtml, createVersion } from './rfp-document-version';
import { invokeModel } from './bedrock-http-client';

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

describe('extractDocumentTitle', () => {
  it('strips a leading &nbsp; entity from the template <h1> title', () => {
    const template = '<h1>&nbsp;Physical Records Storage, Retrieval and Destruction Services</h1>';
    expect(extractDocumentTitle(template, 'TECHNICAL_PROPOSAL')).toBe(
      'Physical Records Storage, Retrieval and Destruction Services',
    );
  });

  it('strips a raw non-breaking-space character from the title', () => {
    const template = '<h1> Physical Records Storage</h1>';
    expect(extractDocumentTitle(template, 'TECHNICAL_PROPOSAL')).toBe('Physical Records Storage');
  });

  it('decodes numeric nbsp entities and collapses internal whitespace', () => {
    const template = '<h1>Storage&#160;&nbsp;Services</h1>';
    expect(extractDocumentTitle(template, 'TECHNICAL_PROPOSAL')).toBe('Storage Services');
  });

  it('strips a leading zero-padded hex nbsp entity (&#x00a0;)', () => {
    const template = '<h1>&#x00a0;Physical Records Storage</h1>';
    expect(extractDocumentTitle(template, 'TECHNICAL_PROPOSAL')).toBe('Physical Records Storage');
  });

  it('strips a leading zero-padded decimal nbsp entity (&#0160;)', () => {
    const template = '<h1>&#0160;Physical Records Storage</h1>';
    expect(extractDocumentTitle(template, 'TECHNICAL_PROPOSAL')).toBe('Physical Records Storage');
  });

  it('strips a bare &nbsp entity without a trailing semicolon', () => {
    const template = '<h1>&nbsp Physical Records Storage</h1>';
    expect(extractDocumentTitle(template, 'TECHNICAL_PROPOSAL')).toBe('Physical Records Storage');
  });

  it('falls back to the document-type label when the title has no real text', () => {
    const template = '<h1>&nbsp;{{PROJECT_TITLE}}</h1>';
    expect(extractDocumentTitle(template, 'TECHNICAL_PROPOSAL')).toBe('Technical Proposal');
  });

  it('falls back to the document-type label when there is no <h1>', () => {
    expect(extractDocumentTitle('<h2>Section</h2>', 'COVER_LETTER')).toBe('Cover Letter');
  });
});

describe('applyTemplateStylesToContent', () => {
  it('does NOT broadcast text-align from the template to AI paragraphs', () => {
    // The template's first styled <p> is a centered title line. Its center
    // alignment must NOT leak onto body paragraphs (the original bug).
    const template =
      '<p style="text-align:center;color:#123456">Centered Title</p>' +
      '<p style="color:#123456">Left body</p>';
    const content = '<p>AI generated paragraph</p>';

    const result = applyTemplateStylesToContent(content, template);

    // Brand color propagates, alignment does not.
    expect(result).toContain('color: #123456');
    expect(result).not.toContain('text-align');
  });

  it('does not center unstyled table cells (Description column stays left)', () => {
    // First styled <td> in the template is a centered number cell; the
    // Description cells are unstyled and must remain left-aligned.
    const template =
      '<table><tr>' +
      '<td style="text-align:center;color:#111">2a</td>' +
      '<td>VitalWeb Portal Access</td>' +
      '</tr></table>';
    const content =
      '<table><tr><td>3a</td><td>New description cell</td></tr></table>';

    const result = applyTemplateStylesToContent(content, template);

    expect(result).not.toContain('text-align: center');
    // Cosmetic color still propagates to cells without their own style.
    expect(result).toContain('color: #111');
  });

  it('strips AI-invented white-on-dark header colors when the template is black-on-white', () => {
    const template =
      '<table><tr><th style="color:#000;font-weight:600">Item</th></tr></table>';
    // AI regenerated the header row with the prompt-default white-on-dark style.
    const content =
      '<table><tr style="background:#333;color:#fff"><th>Item</th></tr></table>';

    const result = applyTemplateStylesToContent(content, template);

    expect(result).not.toMatch(/color:\s*#fff/i);
    expect(result).not.toMatch(/background:\s*#333/i);
  });

  it('strips white header text while keeping a light (non-dark) header background', () => {
    // The client's case: header keeps the template's light lavender background,
    // but the AI colored the text white → invisible text on a light background.
    const template =
      '<table><tr style="background:#e6e6fa"><th style="color:#0b6b3a">Item</th></tr></table>';
    const content =
      '<table><tr style="background:#e6e6fa;color:#fff"><th>Item</th></tr></table>';

    const result = applyTemplateStylesToContent(content, template);

    // White text removed…
    expect(result).not.toMatch(/color:\s*#fff/i);
    // …but the light background is NOT stripped (only dark #333/#000 backgrounds are).
    expect(result).toMatch(/background:\s*#e6e6fa/i);
  });

  it('strips white header text set directly on the <th>', () => {
    const template =
      '<table><tr style="background:#e6e6fa"><th style="color:#0b6b3a">Item</th></tr></table>';
    // No template-forced <th> reshaping needed to hit the strip path: put white on <th>.
    const content =
      '<table><tr style="background:#e6e6fa"><th style="color:#ffffff">Item</th></tr></table>';

    const result = applyTemplateStylesToContent(content, template);

    // The template DOES define a <th> style (color:#0b6b3a), so it is forced back on,
    // overwriting the AI's white text with the template's green header text.
    expect(result).toMatch(/color:\s*#0b6b3a/i);
    expect(result).not.toMatch(/color:\s*#ffffff/i);
  });

  it('strips a dark <tr> background even when the white text lives on the <th>', () => {
    // The AI sometimes splits its invented header look: dark band on the row,
    // white text on the cell. Both halves must be removed, or a black-on-white
    // template ends up with a dark header band (invisible black text on #333).
    const template =
      '<table><tr><th style="color:#0b6b3a">Item</th></tr></table>';
    const content =
      '<table><tr style="background:#333"><th style="color:#fff">Item</th></tr></table>';

    const result = applyTemplateStylesToContent(content, template);

    // Dark row background stripped…
    expect(result).not.toMatch(/background:\s*#333/i);
    // …and the white text on the <th> is replaced by the template's green header.
    expect(result).toMatch(/color:\s*#0b6b3a/i);
    expect(result).not.toMatch(/color:\s*#fff/i);
  });

  it('does not strip a legitimate dark-blue header background that only prefix-matches #000', () => {
    // #0000ff (blue) prefix-matches "#000"; anchoring the regex prevents it from
    // being mistaken for the AI's invented #000 dark background.
    const template =
      '<table><tr style="background:#0000ff"><th style="color:#0b6b3a">Item</th></tr></table>';
    const content =
      '<table><tr style="background:#0000ff;color:#fff"><th>Item</th></tr></table>';

    const result = applyTemplateStylesToContent(content, template);

    // White text is stripped, but the legitimate blue background is preserved.
    expect(result).not.toMatch(/color:\s*#fff/i);
    expect(result).toMatch(/background:\s*#0000ff/i);
  });

  it('preserves intentional white headers when the template itself uses them', () => {
    const template =
      '<table><tr style="background:#333;color:#fff"><th>Item</th></tr></table>';
    const content =
      '<table><tr style="background:#333;color:#fff"><th>Item</th></tr></table>';

    const result = applyTemplateStylesToContent(content, template);

    expect(result).toMatch(/color:\s*#fff/i);
  });

  it('applies the template heading brand color while keeping the heading own alignment', () => {
    const template = '<h2 style="color:#1e40af;font-weight:700">Section</h2>';
    const content = '<h2 style="text-align:center">Generated Section</h2>';

    const result = applyTemplateStylesToContent(content, template);

    expect(result).toContain('color: #1e40af');
    // The AI heading explicitly centered itself — that intent is preserved.
    expect(result).toContain('text-align: center');
  });

  it('does not corrupt a data-style="..." attribute when restyling a heading', () => {
    // The style-strip must not match inside data-style (or any *-style) attribute
    // and leave a dangling "data-" fragment.
    const template = '<h2 style="color:#1e40af">Section</h2>';
    const content = '<h2 data-style="keep" style="color:#000">Generated</h2>';

    const result = applyTemplateStylesToContent(content, template);

    expect(result).toContain('data-style="keep"');
    expect(result).toContain('color: #1e40af');
    expect(result).not.toContain('data- ');
    expect(result).not.toMatch(/data-\s*style="color: #1e40af"/);
  });

  it('returns content unchanged when template has no inline styles', () => {
    const content = '<p>Body</p><h2>Heading</h2>';
    expect(applyTemplateStylesToContent(content, '<p>plain</p>')).toBe(content);
  });
});

describe('processJobInner — document prompt override wiring', () => {
  const job: Job = {
    orgId: 'org-1',
    projectId: 'proj-1',
    opportunityId: 'opp-1',
    documentType: 'TECHNICAL_PROPOSAL',
    documentId: 'doc-1',
  };

  const mockResolveFragments = resolveDocumentPromptFragments as jest.MockedFunction<
    typeof resolveDocumentPromptFragments
  >;
  const mockBuildSystem = buildSystemPromptForDocumentType as jest.MockedFunction<
    typeof buildSystemPromptForDocumentType
  >;
  const mockBuildSection = buildSectionSystemPrompt as jest.MockedFunction<
    typeof buildSectionSystemPrompt
  >;
  const mockBuildUser = buildUserPromptForDocumentType as jest.MockedFunction<
    typeof buildUserPromptForDocumentType
  >;

  beforeEach(() => {
    jest.clearAllMocks();

    mockResolveFragments.mockResolvedValue({ guidance: 'G-OVERRIDE', task: 'T-OVERRIDE' });
    mockBuildSystem.mockReturnValue('sys prompt');
    mockBuildSection.mockReturnValue('section sys prompt');
    mockBuildUser.mockReturnValue('user prompt');

    (loadQaPairs as jest.Mock).mockResolvedValue([]);
    (loadSolicitation as jest.Mock).mockResolvedValue('solicitation text');
    (buildMacroValues as jest.Mock).mockResolvedValue({});
    (gatherAllContext as jest.Mock).mockResolvedValue('kb text');

    (uploadRFPDocumentHtml as jest.Mock).mockResolvedValue('html-key');
    (updateRFPDocumentMetadata as jest.Mock).mockResolvedValue(undefined);
    (getRFPDocument as jest.Mock).mockResolvedValue(null);
    (getLatestVersionNumber as jest.Mock).mockResolvedValue(0);
    (saveVersionHtml as jest.Mock).mockResolvedValue('version-key');
    (createVersion as jest.Mock).mockResolvedValue(undefined);
    (getSolutionPlanByOpportunity as jest.Mock).mockResolvedValue(null);
  });

  it('fetches fragments once and passes them to all builders (section-by-section strategy)', async () => {
    const templateHtml =
      '<h1>Technical Proposal</h1><h2>Approach</h2><p>[CONTENT: write the approach]</p>';
    (resolveTemplateHtml as jest.Mock).mockResolvedValue(templateHtml);

    const realBody = `<h2>Approach</h2><p>${'Our technical approach is comprehensive. '.repeat(10)}</p>`;
    mockSectionGen.mockResolvedValue(['<p>Intro paragraph with substance.</p>', realBody]);

    await processJobInner(job);

    expect(mockResolveFragments).toHaveBeenCalledTimes(1);
    expect(mockResolveFragments).toHaveBeenCalledWith('org-1', 'TECHNICAL_PROPOSAL');

    expect(mockBuildSystem).toHaveBeenCalledWith('TECHNICAL_PROPOSAL', templateHtml, 'G-OVERRIDE');
    expect(mockBuildSection).toHaveBeenCalledWith('TECHNICAL_PROPOSAL', 'G-OVERRIDE');
    expect(mockBuildUser).toHaveBeenCalledWith('TECHNICAL_PROPOSAL', {
      solicitation: 'solicitation text',
      qaText: '[]',
      enrichedKbText: 'kb text',
      taskOverride: 'T-OVERRIDE',
      solutionPlanText: null,
    });
  });

  it('passes the guidance override to the single-shot system prompt (no template)', async () => {
    (resolveTemplateHtml as jest.Mock).mockResolvedValue(null);
    (safeParseJsonFromModel as jest.Mock).mockReturnValue({
      title: 'Technical Proposal',
      htmlContent: '<h2>Approach</h2><p>Generated single-shot content body.</p>',
    });
    (invokeModel as jest.Mock).mockResolvedValue(
      new TextEncoder().encode(
        JSON.stringify({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: '{"title":"Technical Proposal"}' }],
        }),
      ),
    );

    await processJobInner(job);

    expect(mockResolveFragments).toHaveBeenCalledTimes(1);
    // Called for Step 5 and again for the single-shot strategy — both carry the override.
    for (const call of mockBuildSystem.mock.calls) {
      expect(call[2]).toBe('G-OVERRIDE');
    }
    expect(mockBuildUser).toHaveBeenCalledWith('TECHNICAL_PROPOSAL', {
      solicitation: 'solicitation text',
      qaText: '[]',
      enrichedKbText: 'kb text',
      taskOverride: 'T-OVERRIDE',
      solutionPlanText: null,
    });
  });

  it('passes null fragments through when no overrides exist (defaults apply in builders)', async () => {
    mockResolveFragments.mockResolvedValue({ guidance: null, task: null });
    (resolveTemplateHtml as jest.Mock).mockResolvedValue(null);
    (safeParseJsonFromModel as jest.Mock).mockReturnValue({
      title: 'Technical Proposal',
      htmlContent: '<h2>Approach</h2><p>Generated single-shot content body.</p>',
    });
    (invokeModel as jest.Mock).mockResolvedValue(
      new TextEncoder().encode(
        JSON.stringify({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: '{"title":"Technical Proposal"}' }],
        }),
      ),
    );

    await processJobInner(job);

    expect(mockBuildSystem).toHaveBeenCalledWith('TECHNICAL_PROPOSAL', null, null);
    expect(mockBuildUser).toHaveBeenCalledWith('TECHNICAL_PROPOSAL', {
      solicitation: 'solicitation text',
      qaText: '[]',
      enrichedKbText: 'kb text',
      taskOverride: null,
      solutionPlanText: null,
    });
  });
});

describe('loadApprovedSolutionPlanContext', () => {
  const key = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };

  const readyPlan = {
    id: 'plan-1',
    orgId: 'org-1',
    projectId: 'proj-1',
    opportunityId: 'opp-1',
    status: 'READY',
    isStale: false,
    runId: 'run-1',
    contentKey: 'org-1/proj-1/opp-1/solution-plan/v3/solution-plan.html',
    version: 3,
    isUserEdited: false,
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns stripped plain text and the plan for a READY plan', async () => {
    (getSolutionPlanByOpportunity as jest.Mock).mockResolvedValue(readyPlan);
    (loadSolutionPlanHtml as jest.Mock).mockResolvedValue(
      '<h2>Architecture</h2><p>Serverless&nbsp;three-tier   design.</p>',
    );

    const result = await loadApprovedSolutionPlanContext(key);

    expect(result).not.toBeNull();
    expect(result!.plan.id).toBe('plan-1');
    expect(result!.plan.version).toBe(3);
    expect(result!.text).toBe('Architecture Serverless three-tier design.');
  });

  it('decodes common HTML entities instead of leaking them into the prompt', async () => {
    (getSolutionPlanByOpportunity as jest.Mock).mockResolvedValue(readyPlan);
    (loadSolutionPlanHtml as jest.Mock).mockResolvedValue(
      '<p>Design &amp; build &lt;5 services&gt; &quot;fast&quot; &#39;now&#39;</p>',
    );

    const result = await loadApprovedSolutionPlanContext(key);

    expect(result!.text).toBe('Design & build <5 services> "fast" \'now\'');
  });

  it('injects a READY plan even when it is stale (staleness never blocks, ADR-3)', async () => {
    (getSolutionPlanByOpportunity as jest.Mock).mockResolvedValue({
      ...readyPlan,
      isStale: true,
      staleReason: 'Executive brief regenerated',
    });
    (loadSolutionPlanHtml as jest.Mock).mockResolvedValue('<p>Plan body</p>');

    const result = await loadApprovedSolutionPlanContext(key);

    expect(result).not.toBeNull();
    expect(result!.text).toBe('Plan body');
  });

  it('returns null when no plan exists', async () => {
    (getSolutionPlanByOpportunity as jest.Mock).mockResolvedValue(null);

    expect(await loadApprovedSolutionPlanContext(key)).toBeNull();
    expect(loadSolutionPlanHtml).not.toHaveBeenCalled();
  });

  it.each(['GRILLING', 'GENERATING_SOT', 'FAILED'])(
    'returns null when the plan status is %s',
    async (status) => {
      (getSolutionPlanByOpportunity as jest.Mock).mockResolvedValue({ ...readyPlan, status });

      expect(await loadApprovedSolutionPlanContext(key)).toBeNull();
      expect(loadSolutionPlanHtml).not.toHaveBeenCalled();
    },
  );

  it('throws when a READY plan has no contentKey (SoT must not be silently skipped)', async () => {
    (getSolutionPlanByOpportunity as jest.Mock).mockResolvedValue({
      ...readyPlan,
      contentKey: undefined,
    });

    await expect(loadApprovedSolutionPlanContext(key)).rejects.toThrow(
      'READY but has no contentKey',
    );
  });

  it('throws when a READY plan HTML strips to empty text', async () => {
    (getSolutionPlanByOpportunity as jest.Mock).mockResolvedValue(readyPlan);
    (loadSolutionPlanHtml as jest.Mock).mockResolvedValue('<div><p>  </p></div>');

    await expect(loadApprovedSolutionPlanContext(key)).rejects.toThrow('content is empty');
  });

  it('truncates oversized plan text to the budget and logs a warning with plan id + length', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const oversized = 'x'.repeat(SOLUTION_PLAN_TEXT_BUDGET + 500);
    (getSolutionPlanByOpportunity as jest.Mock).mockResolvedValue(readyPlan);
    (loadSolutionPlanHtml as jest.Mock).mockResolvedValue(`<p>${oversized}</p>`);

    const result = await loadApprovedSolutionPlanContext(key);

    expect(result!.text).toHaveLength(SOLUTION_PLAN_TEXT_BUDGET);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`planId=plan-1 length=${SOLUTION_PLAN_TEXT_BUDGET + 500}`),
    );
    warnSpy.mockRestore();
  });

  it('propagates an S3 load failure for a READY plan so the job retries/fails instead of generating without the SoT', async () => {
    (getSolutionPlanByOpportunity as jest.Mock).mockResolvedValue(readyPlan);
    (loadSolutionPlanHtml as jest.Mock).mockRejectedValue(new Error('S3 unavailable'));

    await expect(loadApprovedSolutionPlanContext(key)).rejects.toThrow('S3 unavailable');
  });
});

describe('processJobInner — Solution Plan injection & version stamp (ADR-7)', () => {
  const job: Job = {
    orgId: 'org-1',
    projectId: 'proj-1',
    opportunityId: 'opp-1',
    documentType: 'TECHNICAL_PROPOSAL',
    documentId: 'doc-1',
  };

  const readyPlan = {
    id: 'plan-1',
    orgId: 'org-1',
    projectId: 'proj-1',
    opportunityId: 'opp-1',
    status: 'READY',
    isStale: false,
    runId: 'run-1',
    contentKey: 'org-1/proj-1/opp-1/solution-plan/v3/solution-plan.html',
    version: 3,
    isUserEdited: false,
  };

  const mockBuildUser = buildUserPromptForDocumentType as jest.MockedFunction<
    typeof buildUserPromptForDocumentType
  >;

  const setupSingleShotSuccess = () => {
    (resolveTemplateHtml as jest.Mock).mockResolvedValue(null);
    (safeParseJsonFromModel as jest.Mock).mockReturnValue({
      title: 'Technical Proposal',
      htmlContent: '<h2>Approach</h2><p>Generated single-shot content body.</p>',
    });
    (invokeModel as jest.Mock).mockResolvedValue(
      new TextEncoder().encode(
        JSON.stringify({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: '{"title":"Technical Proposal"}' }],
        }),
      ),
    );
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (resolveDocumentPromptFragments as jest.Mock).mockResolvedValue({ guidance: null, task: null });
    (buildSystemPromptForDocumentType as jest.Mock).mockReturnValue('sys prompt');
    (buildSectionSystemPrompt as jest.Mock).mockReturnValue('section sys prompt');
    mockBuildUser.mockReturnValue('user prompt');

    (loadQaPairs as jest.Mock).mockResolvedValue([]);
    (loadSolicitation as jest.Mock).mockResolvedValue('solicitation text');
    (buildMacroValues as jest.Mock).mockResolvedValue({});
    (gatherAllContext as jest.Mock).mockResolvedValue('kb text');

    (uploadRFPDocumentHtml as jest.Mock).mockResolvedValue('html-key');
    (updateRFPDocumentMetadata as jest.Mock).mockResolvedValue(undefined);
    (getRFPDocument as jest.Mock).mockResolvedValue(null);
    (getLatestVersionNumber as jest.Mock).mockResolvedValue(0);
    (saveVersionHtml as jest.Mock).mockResolvedValue('version-key');
    (createVersion as jest.Mock).mockResolvedValue(undefined);
  });

  it('threads the READY plan text into the user prompt and stamps id + version on save', async () => {
    (getSolutionPlanByOpportunity as jest.Mock).mockResolvedValue(readyPlan);
    (loadSolutionPlanHtml as jest.Mock).mockResolvedValue('<p>Approved plan body</p>');
    setupSingleShotSuccess();

    await processJobInner(job);

    expect(mockBuildUser).toHaveBeenCalledWith('TECHNICAL_PROPOSAL', {
      solicitation: 'solicitation text',
      qaText: '[]',
      enrichedKbText: 'kb text',
      taskOverride: null,
      solutionPlanText: 'Approved plan body',
    });

    expect(updateRFPDocumentMetadata).toHaveBeenCalledWith(
      expect.objectContaining({
        updates: expect.objectContaining({
          htmlContentKey: 'html-key',
          solutionPlanId: 'plan-1',
          solutionPlanVersion: 3,
        }),
      }),
    );
  });

  it('threads the plan-bearing user prompt into section-by-section mode via initialUserPrompt (T8)', async () => {
    (getSolutionPlanByOpportunity as jest.Mock).mockResolvedValue(readyPlan);
    (loadSolutionPlanHtml as jest.Mock).mockResolvedValue('<p>Approved plan body</p>');
    (resolveTemplateHtml as jest.Mock).mockResolvedValue(
      '<h1>Technical Proposal</h1><h2>Approach</h2><p>[CONTENT: write the approach]</p>',
    );
    mockBuildUser.mockReturnValue('user prompt with plan block');
    const realBody = `<h2>Approach</h2><p>${'Our technical approach is comprehensive. '.repeat(10)}</p>`;
    mockSectionGen.mockResolvedValue(['<p>Intro paragraph with substance.</p>', realBody]);

    await processJobInner(job);

    expect(mockBuildUser).toHaveBeenCalledWith(
      'TECHNICAL_PROPOSAL',
      expect.objectContaining({ solutionPlanText: 'Approved plan body' }),
    );
    expect(mockSectionGen).toHaveBeenCalledWith(
      expect.objectContaining({ initialUserPrompt: 'user prompt with plan block' }),
    );
  });

  it('passes null plan text and stamps nothing when no plan exists', async () => {
    (getSolutionPlanByOpportunity as jest.Mock).mockResolvedValue(null);
    setupSingleShotSuccess();

    await processJobInner(job);

    expect(mockBuildUser).toHaveBeenCalledWith('TECHNICAL_PROPOSAL', {
      solicitation: 'solicitation text',
      qaText: '[]',
      enrichedKbText: 'kb text',
      taskOverride: null,
      solutionPlanText: null,
    });

    const saveCall = (updateRFPDocumentMetadata as jest.Mock).mock.calls.find(
      ([args]) => args.updates.htmlContentKey !== undefined,
    );
    expect(saveCall).toBeDefined();
    expect(saveCall![0].updates).not.toHaveProperty('solutionPlanId');
    expect(saveCall![0].updates).not.toHaveProperty('solutionPlanVersion');
  });

  it('passes null plan text when the plan is not READY (mid-grilling)', async () => {
    (getSolutionPlanByOpportunity as jest.Mock).mockResolvedValue({
      ...readyPlan,
      status: 'GRILLING',
      contentKey: undefined,
    });
    setupSingleShotSuccess();

    await processJobInner(job);

    expect(mockBuildUser).toHaveBeenCalledWith('TECHNICAL_PROPOSAL', {
      solicitation: 'solicitation text',
      qaText: '[]',
      enrichedKbText: 'kb text',
      taskOverride: null,
      solutionPlanText: null,
    });
  });
});
