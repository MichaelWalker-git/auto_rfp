/**
 * Tests for the Solution Plan tool set (T6): tool-list composition and
 * delegation to the document-tools dispatcher (including the Brave-backed
 * search_service_pricing since T3).
 */
const mockExecuteDocumentTool = jest.fn();

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
  it('offers exactly the shared subset (incl. search_service_pricing)', () => {
    const names = SOLUTION_PLAN_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual([...SOLUTION_PLAN_SHARED_TOOL_NAMES].sort());
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
