/**
 * Tests for the TechLeadAgent class (T6) — the tool-grounded answering turn
 * and the per-turn tool-call summaries.
 */
const mockInvokeClaudeWithTools = jest.fn();
jest.mock('@/helpers/bedrock-tool-loop', () => ({
  invokeClaudeWithTools: (...a: unknown[]) => mockInvokeClaudeWithTools(...a),
}));

const mockExecuteSolutionPlanTool = jest.fn();
jest.mock('@/helpers/solution-plan-tools', () => ({
  SOLUTION_PLAN_TOOLS: [{ name: 'search_knowledge_base' }],
  executeSolutionPlanTool: (...a: unknown[]) => mockExecuteSolutionPlanTool(...a),
}));

jest.mock('@/helpers/executive-opportunity-brief', () => ({
  truncateText: (text: string, max: number) => (text.length > max ? text.slice(0, max) : text),
}));

import { TechLeadAgent, type TechLeadTurnInput } from './tech-lead-agent';

const turnInput: TechLeadTurnInput = {
  opportunityPrimer: 'PRIMER',
  transcript: [{ role: 'GRILLER', content: 'Q1?' }],
  currentQuestions: 'Q2: What is the team mix?',
  round: 2,
  toolContext: {
    orgId: 'org-1',
    projectId: 'proj-1',
    opportunityId: 'opp-1',
    solutionPlanId: 'plan-1',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockInvokeClaudeWithTools.mockResolvedValue({ answer: 'Concrete answer.' });
  mockExecuteSolutionPlanTool.mockResolvedValue({ tool_use_id: 'tu-1', content: 'ok' });
});

describe('TechLeadAgent.answer', () => {
  it('runs the tool loop with the persona prompt and returns the answer', async () => {
    const agent = new TechLeadAgent({ modelId: 'tech-lead-model' });
    const result = await agent.answer(turnInput);

    expect(result.answer).toBe('Concrete answer.');
    expect(result.toolCalls).toEqual([]);

    const args = mockInvokeClaudeWithTools.mock.calls[0][0];
    expect(args.modelId).toBe('tech-lead-model');
    expect(args.system).toContain('CONCRETE');
    expect(args.user).toContain('Q2: What is the team mix?');
    expect(args.tools).toEqual([{ name: 'search_knowledge_base' }]);
    expect(args.maxTokens).toBe(4000);
    expect(args.maxToolRounds).toBe(4);
  });

  it('honors maxTokens and maxToolRounds overrides', async () => {
    const agent = new TechLeadAgent({ modelId: 'm', maxTokens: 1234, maxToolRounds: 2 });
    await agent.answer(turnInput);

    const args = mockInvokeClaudeWithTools.mock.calls[0][0];
    expect(args.maxTokens).toBe(1234);
    expect(args.maxToolRounds).toBe(2);
  });

  it('executes tools with the tool context and records summaries in call order', async () => {
    mockInvokeClaudeWithTools.mockImplementation(async (args) => {
      await args.toolExecutor('search_knowledge_base', { query: 'certs' }, 'tu-1');
      await args.toolExecutor('search_service_pricing', { services: [{ serviceName: 'Datadog' }] }, 'tu-2');
      return { answer: 'Grounded answer.' };
    });

    const agent = new TechLeadAgent({ modelId: 'm' });
    const result = await agent.answer(turnInput);

    expect(mockExecuteSolutionPlanTool).toHaveBeenCalledWith({
      toolName: 'search_knowledge_base',
      toolInput: { query: 'certs' },
      toolUseId: 'tu-1',
      orgId: 'org-1',
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      solutionPlanId: 'plan-1',
    });
    expect(result.toolCalls).toEqual([
      { toolName: 'search_knowledge_base', summary: 'certs' },
      { toolName: 'search_service_pricing', summary: '[{"serviceName":"Datadog"}]' },
    ]);
  });

  it('propagates tool-loop failures to the caller', async () => {
    mockInvokeClaudeWithTools.mockRejectedValue(new Error('model exploded'));
    const agent = new TechLeadAgent({ modelId: 'm' });
    await expect(agent.answer(turnInput)).rejects.toThrow('model exploded');
  });
});
