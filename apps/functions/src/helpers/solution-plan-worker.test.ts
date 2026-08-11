/**
 * Tests for the Solution Plan grilling worker (T6).
 *
 * Covers the T6-mandated cases: termination token → SYNTHESIZE, round-1 token
 * ignored, mid-text token ignored, max-round cap, stale-runId no-op,
 * idempotent redelivery, FAILED on throw — plus the synthesis happy path and
 * round-bound clamping.
 */
const mockGetPlan = jest.fn();
const mockListMessages = jest.fn();
const mockAppendMessage = jest.fn();
const mockUpdateStatus = jest.fn();
const mockUploadHtml = jest.fn();

jest.mock('@/helpers/solution-plan', () => ({
  getSolutionPlanByOpportunity: (...a: unknown[]) => mockGetPlan(...a),
  listGrillingMessages: (...a: unknown[]) => mockListMessages(...a),
  appendGrillingMessage: (...a: unknown[]) => mockAppendMessage(...a),
  updateSolutionPlanStatus: (...a: unknown[]) => mockUpdateStatus(...a),
  uploadSolutionPlanHtml: (...a: unknown[]) => mockUploadHtml(...a),
}));

const mockEnqueue = jest.fn();
jest.mock('@/helpers/solution-plan-queue', () => ({
  enqueueGrillingRound: (...a: unknown[]) => mockEnqueue(...a),
}));

const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: (...a: unknown[]) => mockInvokeModel(...a),
}));

const mockInvokeClaudeWithTools = jest.fn();
jest.mock('@/helpers/bedrock-tool-loop', () => ({
  invokeClaudeWithTools: (...a: unknown[]) => mockInvokeClaudeWithTools(...a),
}));

const mockInvokeClaudeJson = jest.fn();
jest.mock('@/helpers/executive-opportunity-brief', () => ({
  invokeClaudeJson: (...a: unknown[]) => mockInvokeClaudeJson(...a),
  truncateText: (text: string, max: number) => (text.length > max ? text.slice(0, max) : text),
}));

const mockLoadSolicitation = jest.fn();
jest.mock('@/helpers/document-generation', () => ({
  loadSolicitation: (...a: unknown[]) => mockLoadSolicitation(...a),
  extractBedrockText: (outer: { content?: Array<{ text?: string }> }) =>
    outer.content?.[0]?.text?.trim() ?? '',
}));

const mockFetchBrief = jest.fn();
jest.mock('@/helpers/db-tool-helpers', () => ({
  fetchExecutiveBriefAnalysis: (...a: unknown[]) => mockFetchBrief(...a),
}));

jest.mock('@/helpers/solution-plan-tools', () => ({
  SOLUTION_PLAN_TOOLS: [],
  executeSolutionPlanTool: jest.fn().mockResolvedValue({ tool_use_id: 'tu-1', content: 'ok' }),
  summarizeToolInput: (toolInput: Record<string, unknown>) => {
    const interesting = toolInput.query ?? toolInput.services;
    return typeof interesting === 'string' ? interesting : JSON.stringify(interesting);
  },
}));

import {
  MAX_GRILLING_ROUNDS_CAP,
  MIN_GRILLING_ROUNDS,
  processGrillingRound,
  processSynthesis,
  resolveMaxRounds,
} from './solution-plan-worker';
import type { GrillingRoundMessage } from './solution-plan-queue';

const message: GrillingRoundMessage = {
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  solutionPlanId: 'plan-1',
  runId: 'run-1',
  round: 1,
  phase: 'GRILL',
};

const planKey = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };

const basePlan = {
  id: 'plan-1',
  ...planKey,
  status: 'GRILLING',
  isStale: false,
  runId: 'run-1',
  version: 0,
  isUserEdited: false,
};

/** Encode a Bedrock-shaped response body the Griller turn can decode. */
const bedrockText = (text: string): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text }] }));

const grillerMsg = (round: number, content = 'Question?') => ({
  id: `g-${round}`,
  solutionPlanId: 'plan-1',
  runId: 'run-1',
  round,
  role: 'GRILLER',
  content,
});

const techLeadMsg = (round: number, content = 'Answer.') => ({
  id: `t-${round}`,
  solutionPlanId: 'plan-1',
  runId: 'run-1',
  round,
  role: 'TECH_LEAD',
  content,
});

/** Roles of the messages appended during a test, in call order. */
const appendedRoles = () => mockAppendMessage.mock.calls.map(([args]) => args.role);

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.SOLUTION_PLAN_MAX_ROUNDS;

  mockGetPlan.mockResolvedValue({ ...basePlan });
  mockListMessages.mockResolvedValue([]);
  mockAppendMessage.mockImplementation((args) => Promise.resolve(args));
  mockUpdateStatus.mockResolvedValue({});
  mockUploadHtml.mockResolvedValue('org-1/proj-1/opp-1/solution-plan/v1/solution-plan.html');
  mockEnqueue.mockResolvedValue(undefined);
  mockLoadSolicitation.mockResolvedValue('SOLICITATION TEXT');
  mockFetchBrief.mockResolvedValue('BRIEF TEXT');
  mockInvokeModel.mockResolvedValue(bedrockText('Q1: What is the architecture?'));
  mockInvokeClaudeWithTools.mockResolvedValue({ answer: 'Concrete answer.' });
  mockInvokeClaudeJson.mockResolvedValue({
    title: 'Solution Plan',
    htmlContent: '<h2>Solution Architecture</h2><p>…</p>',
  });
});

// ─── Round bounds ───────────────────────────────────────────────────────────────

describe('resolveMaxRounds', () => {
  it('defaults to 4', () => {
    expect(resolveMaxRounds()).toBe(4);
  });

  it('clamps below the minimum of 2 (ADR-13)', () => {
    process.env.SOLUTION_PLAN_MAX_ROUNDS = '1';
    expect(resolveMaxRounds()).toBe(MIN_GRILLING_ROUNDS);
  });

  it('clamps above the hard cap of 8', () => {
    process.env.SOLUTION_PLAN_MAX_ROUNDS = '20';
    expect(resolveMaxRounds()).toBe(MAX_GRILLING_ROUNDS_CAP);
  });

  it('falls back to the default on a non-numeric value', () => {
    process.env.SOLUTION_PLAN_MAX_ROUNDS = 'lots';
    expect(resolveMaxRounds()).toBe(4);
  });
});

// ─── processGrillingRound ───────────────────────────────────────────────────────

describe('processGrillingRound', () => {
  it('runs a full round: griller → tech lead → next round enqueued', async () => {
    await processGrillingRound(message);

    expect(appendedRoles()).toEqual(['GRILLER', 'TECH_LEAD']);
    expect(mockUpdateStatus).toHaveBeenCalledWith(planKey, 'GRILLING', { grillingRounds: 1 });
    expect(mockEnqueue).toHaveBeenCalledWith({ ...message, round: 2, phase: 'GRILL' });
  });

  it('terminates to SYNTHESIZE when the token is honored (round ≥ 2)', async () => {
    mockListMessages.mockResolvedValue([grillerMsg(1), techLeadMsg(1)]);
    mockInvokeModel.mockResolvedValue(bedrockText('INTERVIEW_COMPLETE'));

    await processGrillingRound({ ...message, round: 2 });

    // Griller message persisted, then the SYSTEM completion marker — no Tech Lead turn
    expect(appendedRoles()).toEqual(['GRILLER', 'SYSTEM']);
    expect(mockInvokeClaudeWithTools).not.toHaveBeenCalled();
    expect(mockUpdateStatus).toHaveBeenCalledWith(
      planKey,
      'GENERATING_SOT',
      expect.objectContaining({ grillingRounds: 2, grillingCompletedAt: expect.any(String) }),
    );
    expect(mockEnqueue).toHaveBeenCalledWith({ ...message, round: 2, phase: 'SYNTHESIZE' });
  });

  it('ignores the token in round 1 and continues the interview', async () => {
    mockInvokeModel.mockResolvedValue(bedrockText('INTERVIEW_COMPLETE'));

    await processGrillingRound(message);

    expect(mockInvokeClaudeWithTools).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith({ ...message, round: 2, phase: 'GRILL' });
  });

  it('ignores a mid-text token leak and continues the interview', async () => {
    mockListMessages.mockResolvedValue([grillerMsg(1), techLeadMsg(1)]);
    mockInvokeModel.mockResolvedValue(
      bedrockText('When satisfied I will output INTERVIEW_COMPLETE. Q1: What is the SLA target?'),
    );

    await processGrillingRound({ ...message, round: 2 });

    expect(mockInvokeClaudeWithTools).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith({ ...message, round: 3, phase: 'GRILL' });
  });

  it('forces SYNTHESIZE at the max-round cap even without the token', async () => {
    mockListMessages.mockResolvedValue([
      grillerMsg(1), techLeadMsg(1), grillerMsg(2), techLeadMsg(2), grillerMsg(3), techLeadMsg(3),
    ]);
    mockInvokeModel.mockResolvedValue(bedrockText('Q1: One more question?'));

    await processGrillingRound({ ...message, round: 4 });

    // Final round still answers the questions, then terminates (ADR-13)
    expect(appendedRoles()).toEqual(['GRILLER', 'TECH_LEAD', 'SYSTEM']);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith({ ...message, round: 4, phase: 'SYNTHESIZE' });
  });

  it('no-ops on a stale runId (zombie round, ADR-5)', async () => {
    mockGetPlan.mockResolvedValue({ ...basePlan, runId: 'run-2' });

    await processGrillingRound(message);

    expect(mockInvokeModel).not.toHaveBeenCalled();
    expect(mockAppendMessage).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it('no-ops when the plan does not exist', async () => {
    mockGetPlan.mockResolvedValue(null);
    await processGrillingRound(message);
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('no-ops when the plan is not GRILLING', async () => {
    mockGetPlan.mockResolvedValue({ ...basePlan, status: 'READY' });
    await processGrillingRound(message);
    expect(mockInvokeModel).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('re-enqueues SYNTHESIZE when the plan is stuck in GENERATING_SOT for this run', async () => {
    mockGetPlan.mockResolvedValue({ ...basePlan, status: 'GENERATING_SOT' });

    await processGrillingRound(message);

    expect(mockInvokeModel).not.toHaveBeenCalled();
    expect(mockAppendMessage).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledWith({ ...message, phase: 'SYNTHESIZE' });
  });

  it('re-drives the enqueue without re-running turns when a fully-processed round is redelivered', async () => {
    mockListMessages.mockResolvedValue([grillerMsg(1), techLeadMsg(1)]);

    await processGrillingRound(message);

    // Both turns are reused — no model calls, no new messages — but the round
    // still routes forward so a crash-before-enqueue never strands the plan.
    expect(mockInvokeModel).not.toHaveBeenCalled();
    expect(mockInvokeClaudeWithTools).not.toHaveBeenCalled();
    expect(mockAppendMessage).not.toHaveBeenCalled();
    expect(mockEnqueue).toHaveBeenCalledWith({ ...message, round: 2, phase: 'GRILL' });
  });

  it('resumes a half-completed round on redelivery: reuses the Griller turn, runs only the Tech Lead', async () => {
    mockListMessages.mockResolvedValue([grillerMsg(1, 'Q1: What is the architecture?')]);

    await processGrillingRound(message);

    expect(mockInvokeModel).not.toHaveBeenCalled();
    expect(mockInvokeClaudeWithTools).toHaveBeenCalledTimes(1);
    // The reused Griller questions are handed to the Tech Lead turn
    expect(mockInvokeClaudeWithTools.mock.calls[0][0].user).toContain('Q1: What is the architecture?');
    expect(appendedRoles()).toEqual(['TECH_LEAD']);
    expect(mockEnqueue).toHaveBeenCalledWith({ ...message, round: 2, phase: 'GRILL' });
  });

  it('completes the interview from a reused Griller termination turn on redelivery', async () => {
    mockListMessages.mockResolvedValue([
      grillerMsg(1), techLeadMsg(1), grillerMsg(2, 'INTERVIEW_COMPLETE'),
    ]);

    await processGrillingRound({ ...message, round: 2 });

    expect(mockInvokeModel).not.toHaveBeenCalled();
    expect(mockInvokeClaudeWithTools).not.toHaveBeenCalled();
    expect(appendedRoles()).toEqual(['SYSTEM']);
    expect(mockEnqueue).toHaveBeenCalledWith({ ...message, round: 2, phase: 'SYNTHESIZE' });
  });

  it('does NOT skip when the existing round messages belong to another run', async () => {
    mockListMessages.mockResolvedValue([
      { ...grillerMsg(1), runId: 'run-0' },
      { ...techLeadMsg(1), runId: 'run-0' },
    ]);

    await processGrillingRound(message);

    expect(mockInvokeModel).toHaveBeenCalledTimes(1);
    expect(mockEnqueue).toHaveBeenCalledWith({ ...message, round: 2, phase: 'GRILL' });
  });

  it('sets FAILED with the error message and rethrows when a turn throws', async () => {
    mockInvokeModel.mockRejectedValue(new Error('Bedrock unavailable'));

    await expect(processGrillingRound(message)).rejects.toThrow('Bedrock unavailable');

    expect(mockUpdateStatus).toHaveBeenCalledWith(planKey, 'FAILED', {
      error: 'Bedrock unavailable',
    });
    expect(appendedRoles()).toContain('SYSTEM');
  });

  it('records tool-call summaries on the TECH_LEAD message', async () => {
    mockInvokeClaudeWithTools.mockImplementation(async (args) => {
      await args.toolExecutor('search_knowledge_base', { query: 'certs' }, 'tu-1');
      return { answer: 'Grounded answer.' };
    });

    await processGrillingRound(message);

    const techLeadCall = mockAppendMessage.mock.calls.find(([args]) => args.role === 'TECH_LEAD');
    expect(techLeadCall?.[0].toolCalls).toEqual([
      { toolName: 'search_knowledge_base', summary: 'certs' },
    ]);
  });
});

// ─── processSynthesis ───────────────────────────────────────────────────────────

describe('processSynthesis', () => {
  const synthMessage: GrillingRoundMessage = { ...message, round: 2, phase: 'SYNTHESIZE' };

  beforeEach(() => {
    mockGetPlan.mockResolvedValue({ ...basePlan, status: 'GENERATING_SOT', version: 2 });
    mockListMessages.mockResolvedValue([grillerMsg(1), techLeadMsg(1), grillerMsg(2), techLeadMsg(2)]);
  });

  it('synthesizes, uploads a new S3 version, and flips the plan to READY', async () => {
    await processSynthesis(synthMessage);

    // Monotonic version bump from the plan's current counter (ADR-11)
    expect(mockUploadHtml).toHaveBeenCalledWith(planKey, 3, expect.stringContaining('<h2>Solution Architecture</h2>'));
    expect(mockUpdateStatus).toHaveBeenCalledWith(planKey, 'READY', {
      contentKey: 'org-1/proj-1/opp-1/solution-plan/v1/solution-plan.html',
      version: 3,
      isStale: false,
      staleReason: '',
      isUserEdited: false,
      error: '',
    });
    expect(appendedRoles()).toEqual(['SYSTEM']);
  });

  it('prepends the title as <h1> when the model omitted a heading', async () => {
    await processSynthesis(synthMessage);
    const [, , html] = mockUploadHtml.mock.calls[0];
    expect(html).toMatch(/^<h1>Solution Plan<\/h1>/);
  });

  it('no-ops on a stale runId (ADR-5)', async () => {
    mockGetPlan.mockResolvedValue({ ...basePlan, status: 'GENERATING_SOT', runId: 'run-9' });
    await processSynthesis(synthMessage);
    expect(mockInvokeClaudeJson).not.toHaveBeenCalled();
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it('skips redelivery when the plan is already READY', async () => {
    mockGetPlan.mockResolvedValue({ ...basePlan, status: 'READY' });
    await processSynthesis(synthMessage);
    expect(mockInvokeClaudeJson).not.toHaveBeenCalled();
    expect(mockUploadHtml).not.toHaveBeenCalled();
  });

  it('fails when the transcript has no Tech Lead answers', async () => {
    mockListMessages.mockResolvedValue([grillerMsg(1)]);

    await expect(processSynthesis(synthMessage)).rejects.toThrow('nothing to synthesize');
    expect(mockUpdateStatus).toHaveBeenCalledWith(planKey, 'FAILED', {
      error: expect.stringContaining('nothing to synthesize'),
    });
  });

  it('sets FAILED and rethrows when synthesis throws', async () => {
    mockInvokeClaudeJson.mockRejectedValue(new Error('model exploded'));

    await expect(processSynthesis(synthMessage)).rejects.toThrow('model exploded');
    expect(mockUpdateStatus).toHaveBeenCalledWith(planKey, 'FAILED', { error: 'model exploded' });
  });
});
