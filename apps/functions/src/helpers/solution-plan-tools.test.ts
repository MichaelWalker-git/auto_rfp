/**
 * Tests for the Solution Plan tool set (T6): tool-list composition and
 * delegation to the document-tools dispatcher (including the Brave-backed
 * search_service_pricing since T3).
 */
const mockExecuteDocumentTool = jest.fn();
const mockLoadRawSolicitationDocuments = jest.fn();

jest.mock('@/helpers/executive-opportunity-brief', () => ({
  loadRawSolicitationDocuments: (...a: unknown[]) => mockLoadRawSolicitationDocuments(...a),
  truncateText: (text: string, maxChars: number) =>
    text.length > maxChars ? `${text.slice(0, maxChars)}\n\n[TRUNCATED]` : text,
}));

jest.mock('@/helpers/document-tools', () => ({
  DOCUMENT_TOOLS: [
    { name: 'search_past_performance', description: 'd', input_schema: { type: 'object', properties: {}, required: [] } },
    { name: 'search_knowledge_base', description: 'd', input_schema: { type: 'object', properties: {}, required: [] } },
    { name: 'get_qa_answers', description: 'd', input_schema: { type: 'object', properties: {}, required: [] } },
    { name: 'get_organization_context', description: 'd', input_schema: { type: 'object', properties: {}, required: [] } },
    { name: 'get_executive_brief_analysis', description: 'd', input_schema: { type: 'object', properties: {}, required: [] } },
    { name: 'get_pricing_data', description: 'd', input_schema: { type: 'object', properties: {}, required: [] } },
    { name: 'get_content_library', description: 'd', input_schema: { type: 'object', properties: {}, required: [] } },
    { name: 'get_deadlines', description: 'd', input_schema: { type: 'object', properties: {}, required: [] } },
    { name: 'search_service_pricing', description: 'd', input_schema: { type: 'object', properties: {}, required: ['services'] } },
  ],
  executeDocumentTool: (...a: unknown[]) => mockExecuteDocumentTool(...a),
}));

import {
  FETCH_SOLICITATION_SECTION_TOOL_NAME,
  SOLUTION_PLAN_SHARED_TOOL_NAMES,
  SOLUTION_PLAN_TOOLS,
  executeSolutionPlanTool,
  summarizeToolInput,
} from './solution-plan-tools';

const baseArgs = {
  toolUseId: 'tu-1',
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  solutionPlanId: 'plan-1',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SOLUTION_PLAN_TOOLS', () => {
  it('offers exactly the shared subset plus fetch_solicitation_section (incl. search_service_pricing)', () => {
    const names = SOLUTION_PLAN_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [...SOLUTION_PLAN_SHARED_TOOL_NAMES, FETCH_SOLICITATION_SECTION_TOOL_NAME].sort(),
    );
  });

  it('excludes document-only tools like get_qa_answers and get_deadlines', () => {
    const names = SOLUTION_PLAN_TOOLS.map((t) => t.name);
    expect(names).not.toContain('get_qa_answers');
    expect(names).not.toContain('get_content_library');
    expect(names).not.toContain('get_deadlines');
  });
});

describe('executeSolutionPlanTool — search_service_pricing', () => {
  it('delegates to the document-tools dispatcher (real Brave-backed lookup, T3)', async () => {
    mockExecuteDocumentTool.mockResolvedValue({ tool_use_id: 'tu-1', content: 'pricing table' });

    const toolInput = {
      services: [
        { serviceName: 'GitHub Enterprise', billingPeriod: 'ANNUAL' },
        { serviceName: 'Datadog Pro' },
      ],
    };
    const result = await executeSolutionPlanTool({
      ...baseArgs,
      toolName: 'search_service_pricing',
      toolInput,
    });

    expect(mockExecuteDocumentTool).toHaveBeenCalledWith({
      toolName: 'search_service_pricing',
      toolInput,
      toolUseId: 'tu-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      documentId: 'plan-1',
      qaPairs: [],
    });
    expect(result.content).toBe('pricing table');
  });
});

describe('summarizeToolInput', () => {
  it('summarizes a query-shaped input as the query string', () => {
    expect(summarizeToolInput({ query: 'ISO certifications' })).toBe('ISO certifications');
  });

  it('summarizes a services-shaped input as compact JSON', () => {
    expect(summarizeToolInput({ services: [{ serviceName: 'Datadog' }] })).toBe(
      '[{"serviceName":"Datadog"}]',
    );
  });

  it('returns an empty string when no known field is present', () => {
    expect(summarizeToolInput({ somethingElse: true })).toBe('');
  });

  it('caps the summary at 200 characters', () => {
    expect(summarizeToolInput({ query: 'x'.repeat(500) })).toHaveLength(200);
  });
});

describe('executeSolutionPlanTool — delegation', () => {
  it('delegates shared tools to executeDocumentTool with the plan id as documentId', async () => {
    mockExecuteDocumentTool.mockResolvedValue({ tool_use_id: 'tu-1', content: 'KB results' });

    const result = await executeSolutionPlanTool({
      ...baseArgs,
      toolName: 'search_knowledge_base',
      toolInput: { query: 'ISO certifications' },
    });

    expect(mockExecuteDocumentTool).toHaveBeenCalledWith({
      toolName: 'search_knowledge_base',
      toolInput: { query: 'ISO certifications' },
      toolUseId: 'tu-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      documentId: 'plan-1',
      qaPairs: [],
    });
    expect(result.content).toBe('KB results');
  });

  it('strips the scoring section from get_executive_brief_analysis requests', async () => {
    mockExecuteDocumentTool.mockResolvedValue({ tool_use_id: 'tu-1', content: 'brief' });

    await executeSolutionPlanTool({
      ...baseArgs,
      toolName: 'get_executive_brief_analysis',
      toolInput: { sections: ['summary', 'scoring', 'risks'] },
    });

    expect(mockExecuteDocumentTool).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: 'get_executive_brief_analysis',
        toolInput: { sections: ['summary', 'risks'] },
      }),
    );
  });

  it('defaults get_executive_brief_analysis to the allowed sections when none are requested', async () => {
    mockExecuteDocumentTool.mockResolvedValue({ tool_use_id: 'tu-1', content: 'brief' });

    await executeSolutionPlanTool({
      ...baseArgs,
      toolName: 'get_executive_brief_analysis',
      toolInput: {},
    });

    const [{ toolInput }] = mockExecuteDocumentTool.mock.calls[0] as [
      { toolInput: { sections: string[] } },
    ];
    expect(toolInput.sections).toEqual([
      'summary', 'deadlines', 'requirements', 'contacts', 'risks', 'pricing', 'pastPerformance',
    ]);
    expect(toolInput.sections).not.toContain('scoring');
  });

  it('falls back to the allowed sections when only scoring was requested', async () => {
    mockExecuteDocumentTool.mockResolvedValue({ tool_use_id: 'tu-1', content: 'brief' });

    await executeSolutionPlanTool({
      ...baseArgs,
      toolName: 'get_executive_brief_analysis',
      toolInput: { sections: ['scoring'] },
    });

    const [{ toolInput }] = mockExecuteDocumentTool.mock.calls[0] as [
      { toolInput: { sections: string[] } },
    ];
    expect(toolInput.sections).not.toContain('scoring');
    expect(toolInput.sections.length).toBeGreaterThan(0);
  });

  it('rejects tools outside the solution-plan set without calling the dispatcher', async () => {
    const result = await executeSolutionPlanTool({
      ...baseArgs,
      toolName: 'get_qa_answers',
      toolInput: { topic: 'pricing' },
    });
    expect(result.content).toBe('Unknown tool: get_qa_answers');
    expect(mockExecuteDocumentTool).not.toHaveBeenCalled();
  });
});

describe('executeSolutionPlanTool — fetch_solicitation_section', () => {
  const MAIN_DOC_TEXT = [
    'INTRODUCTION',
    'This is the introduction to the RFP.',
    '',
    '2.1 SCOPE OF WORK',
    'The contractor shall provide cloud migration services for the agency data center.',
    'Pricing must be submitted as a fixed-price CLIN structure.',
    '',
    '2.2 PERIOD OF PERFORMANCE',
    'Base year plus four option years.',
  ].join('\n');

  beforeEach(() => {
    mockLoadRawSolicitationDocuments.mockResolvedValue([
      { file: {}, fileName: 'RFP Main.pdf', text: MAIN_DOC_TEXT },
      { file: {}, fileName: 'Attachment A.pdf', text: 'Attachment content here.' },
    ]);
  });

  it('returns context around the first keyword match', async () => {
    const result = await executeSolutionPlanTool({
      ...baseArgs,
      toolName: 'fetch_solicitation_section',
      toolInput: { documentName: 'RFP Main.pdf', keywords: ['fixed-price CLIN'] },
    });

    expect(result.content).toContain('fixed-price CLIN structure');
    expect(mockExecuteDocumentTool).not.toHaveBeenCalled();
  });

  it('returns the enclosing section for a sectionHint', async () => {
    const result = await executeSolutionPlanTool({
      ...baseArgs,
      toolName: 'fetch_solicitation_section',
      toolInput: { documentName: 'RFP Main.pdf', sectionHint: 'SCOPE OF WORK' },
    });

    expect(result.content).toContain('2.1 SCOPE OF WORK');
    expect(result.content).toContain('cloud migration services');
    expect(result.content).not.toContain('PERIOD OF PERFORMANCE');
  });

  it('returns the outline when neither keywords nor sectionHint is given', async () => {
    const result = await executeSolutionPlanTool({
      ...baseArgs,
      toolName: 'fetch_solicitation_section',
      toolInput: { documentName: 'RFP Main.pdf' },
    });

    expect(result.content).toContain('Outline of "RFP Main.pdf"');
    expect(result.content).toContain('2.1 SCOPE OF WORK');
  });

  it('reports unknown documents with the available list', async () => {
    const result = await executeSolutionPlanTool({
      ...baseArgs,
      toolName: 'fetch_solicitation_section',
      toolInput: { documentName: 'Nonexistent.pdf' },
    });

    expect(result.content).toContain('Unknown document "Nonexistent.pdf"');
    expect(result.content).toContain('RFP Main.pdf');
    expect(result.content).toContain('Attachment A.pdf');
  });

  it('enforces the 6,000-char cap on the response', async () => {
    mockLoadRawSolicitationDocuments.mockResolvedValue([
      { file: {}, fileName: 'Huge.pdf', text: 'x'.repeat(20_000) },
    ]);

    const result = await executeSolutionPlanTool({
      ...baseArgs,
      toolName: 'fetch_solicitation_section',
      toolInput: { documentName: 'Huge.pdf', keywords: ['x'] },
    });

    expect(result.content.length).toBeLessThanOrEqual(6_000 + '\n\n[TRUNCATED]'.length);
  });
});
