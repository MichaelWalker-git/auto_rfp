/**
 * Tests for the Solution Plan tool set (T6): tool-list composition, the
 * search_service_pricing stub (ADR-15 degradation shape), and delegation to
 * the document-tools dispatcher.
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
  it('offers exactly the shared subset plus search_service_pricing', () => {
    const names = SOLUTION_PLAN_TOOLS.map((t) => t.name).sort();
    expect(names).toEqual(
      [...SOLUTION_PLAN_SHARED_TOOL_NAMES, 'search_service_pricing'].sort(),
    );
  });

  it('excludes document-only tools like get_qa_answers and get_deadlines', () => {
    const names = SOLUTION_PLAN_TOOLS.map((t) => t.name);
    expect(names).not.toContain('get_qa_answers');
    expect(names).not.toContain('get_content_library');
    expect(names).not.toContain('get_deadlines');
  });

  it('search_service_pricing uses the batched input schema', () => {
    const tool = SOLUTION_PLAN_TOOLS.find((t) => t.name === 'search_service_pricing');
    expect(tool?.input_schema.required).toEqual(['services']);
    expect(tool?.description).toContain('ONE call');
  });
});

describe('executeSolutionPlanTool — search_service_pricing stub', () => {
  it('returns a vendor-quote-required row per service and never throws (ADR-15)', async () => {
    const result = await executeSolutionPlanTool({
      ...baseArgs,
      toolName: 'search_service_pricing',
      toolInput: {
        services: [
          { serviceName: 'GitHub Enterprise', billingPeriod: 'ANNUAL' },
          { serviceName: 'Datadog Pro' },
        ],
      },
    });

    expect(result.tool_use_id).toBe('tu-1');
    expect(result.content).toContain('| GitHub Enterprise | vendor quote required (lookup unavailable)');
    expect(result.content).toContain('| Datadog Pro | vendor quote required (lookup unavailable)');
    expect(result.content).toContain('ESTIMATES — subject to vendor quote');
    expect(mockExecuteDocumentTool).not.toHaveBeenCalled();
  });

  it('handles empty/malformed input without throwing', async () => {
    const result = await executeSolutionPlanTool({
      ...baseArgs,
      toolName: 'search_service_pricing',
      toolInput: { services: 'not-an-array' },
    });
    expect(result.content).toContain('No services provided');
  });

  it('caps the batch at 10 services', async () => {
    const services = Array.from({ length: 12 }, (_, i) => ({ serviceName: `Service ${i + 1}` }));
    const result = await executeSolutionPlanTool({
      ...baseArgs,
      toolName: 'search_service_pricing',
      toolInput: { services },
    });
    expect(result.content).toContain('Service 10');
    expect(result.content).not.toContain('Service 11');
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
