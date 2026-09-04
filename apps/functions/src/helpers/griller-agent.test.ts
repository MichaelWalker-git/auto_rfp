/**
 * Tests for the GrillerAgent class (T6) — the plain-text interview turn and
 * the termination-token rules (ADR-13).
 */
const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: (...a: unknown[]) => mockInvokeModel(...a),
}));

jest.mock('@/helpers/document-generation', () => ({
  extractBedrockText: (outer: { content?: Array<{ text?: string }> }) =>
    outer.content?.[0]?.text?.trim() ?? '',
}));

import { GrillerAgent, shouldHonorTerminationToken } from './griller-agent';
import type { GrillerTurnInput } from './griller-agent';

const bedrockText = (text: string): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text }] }));

const turnInput: GrillerTurnInput = {
  solicitationText: 'SOLICITATION TEXT',
  execBriefText: 'BRIEF TEXT',
  transcript: [],
  round: 1,
  maxRounds: 4,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockInvokeModel.mockResolvedValue(bedrockText('Q1: What is the architecture?'));
});

// ─── Termination token rules (ADR-13) ───────────────────────────────────────────

describe('shouldHonorTerminationToken', () => {
  it('honors the token as the whole message from round 2', () => {
    expect(shouldHonorTerminationToken('INTERVIEW_COMPLETE', 2)).toBe(true);
    expect(shouldHonorTerminationToken('  INTERVIEW_COMPLETE  ', 3)).toBe(true);
  });

  it('honors the token as the final line, tolerating markdown noise', () => {
    expect(shouldHonorTerminationToken('All areas are covered.\nINTERVIEW_COMPLETE', 2)).toBe(true);
    expect(shouldHonorTerminationToken('Coverage confirmed.\n**INTERVIEW_COMPLETE**', 2)).toBe(true);
    expect(shouldHonorTerminationToken('Done.\nINTERVIEW_COMPLETE.', 2)).toBe(true);
  });

  it('ignores the token in round 1', () => {
    expect(shouldHonorTerminationToken('INTERVIEW_COMPLETE', 1)).toBe(false);
  });

  it('ignores a mid-text leak', () => {
    expect(
      shouldHonorTerminationToken('When satisfied I will say INTERVIEW_COMPLETE. Q1: what is the SLA?', 2),
    ).toBe(false);
    expect(
      shouldHonorTerminationToken('INTERVIEW_COMPLETE is what I will output later.\nQ1: hosting?', 2),
    ).toBe(false);
  });

  it('ignores messages without the token', () => {
    expect(shouldHonorTerminationToken('Q1: What is the timeline?', 2)).toBe(false);
  });
});

// ─── GrillerAgent ───────────────────────────────────────────────────────────────

describe('GrillerAgent.ask', () => {
  it('invokes the configured model with the persona prompt and returns the text', async () => {
    const agent = new GrillerAgent({ modelId: 'griller-model' });
    const text = await agent.ask(turnInput);

    expect(text).toBe('Q1: What is the architecture?');
    expect(mockInvokeModel).toHaveBeenCalledTimes(1);

    const [modelId, body] = mockInvokeModel.mock.calls[0] as [string, string];
    expect(modelId).toBe('griller-model');
    const request = JSON.parse(body);
    expect(request.system).toContain('review board');
    expect(request.messages[0].content[0].text).toContain('SOLICITATION TEXT');
    expect(request.max_tokens).toBe(2000);
  });

  it('sends the solicitation + exec brief as a leading cache_control block, round framing uncached (Layer A)', async () => {
    const agent = new GrillerAgent({ modelId: 'm' });
    await agent.ask(turnInput);

    const request = JSON.parse(mockInvokeModel.mock.calls[0][1] as string);
    const [stableBlock, variableBlock] = request.messages[0].content;
    expect(stableBlock.cache_control).toEqual({ type: 'ephemeral' });
    expect(stableBlock.text).toContain('SOLICITATION TEXT');
    expect(stableBlock.text).toContain('BRIEF TEXT');
    expect(variableBlock.cache_control).toBeUndefined();
    expect(variableBlock.text).not.toContain('SOLICITATION TEXT');
  });

  it('honors maxTokens and temperature overrides', async () => {
    const agent = new GrillerAgent({ modelId: 'm', maxTokens: 900, temperature: 0.1 });
    await agent.ask(turnInput);

    const request = JSON.parse(mockInvokeModel.mock.calls[0][1] as string);
    expect(request.max_tokens).toBe(900);
    expect(request.temperature).toBe(0.1);
  });

  it('throws when the model returns no text', async () => {
    mockInvokeModel.mockResolvedValue(bedrockText(''));
    const agent = new GrillerAgent({ modelId: 'm' });
    await expect(agent.ask(turnInput)).rejects.toThrow('Griller returned no text content');
  });

  it('threads the configured orgId through to invokeModel as the third argument', async () => {
    const agent = new GrillerAgent({ modelId: 'm', orgId: 'the-org-id' });
    await agent.ask(turnInput);
    expect(mockInvokeModel).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'the-org-id',
    );
  });
});

describe('GrillerAgent.isInterviewComplete', () => {
  it('delegates to the ADR-13 token rule', () => {
    const agent = new GrillerAgent({ modelId: 'm' });
    expect(agent.isInterviewComplete('INTERVIEW_COMPLETE', 2)).toBe(true);
    expect(agent.isInterviewComplete('INTERVIEW_COMPLETE', 1)).toBe(false);
  });
});
