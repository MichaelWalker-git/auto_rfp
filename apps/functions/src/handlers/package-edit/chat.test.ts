jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});
jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h }));
jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({}),
  orgMembershipMiddleware: () => ({}),
  requirePermission: () => ({}),
  httpErrorMiddleware: () => ({}),
}));
jest.mock('@/helpers/env', () => ({ requireEnv: (_k: string, d?: string) => d ?? 'test' }));

const mockGetOpportunity = jest.fn();
jest.mock('@/helpers/opportunity', () => ({ getOpportunity: (...a: unknown[]) => mockGetOpportunity(...a) }));

const mockInvoke = jest.fn();
jest.mock('@/helpers/bedrock-tool-loop', () => ({ invokeClaudeWithTools: (...a: unknown[]) => mockInvoke(...a) }));

jest.mock('@/helpers/compliance-review-tools', () => ({
  COMPLIANCE_REVIEW_TOOLS: [],
  makeComplianceToolExecutor: jest.fn(() => jest.fn()),
  buildPackageInventory: jest.fn().mockResolvedValue({ documents: [], forms: [] }),
}));

const mockCreateProposalRun = jest.fn();
jest.mock('@/helpers/package-edit', () => ({
  createProposalRun: (...a: unknown[]) => mockCreateProposalRun(...a),
}));

const mockEnqueue = jest.fn();
jest.mock('@/helpers/package-edit-queue', () => ({
  enqueuePackageEditProposal: (...a: unknown[]) => mockEnqueue(...a),
}));

jest.mock('@/helpers/compliance-review-snapshot', () => ({
  buildPackageSnapshot: jest.fn().mockResolvedValue({ 'doc:1': 't' }),
}));

// The single-loop handler parses the model output against ReviewOutputSchema
// (kept real so parsing behaves) and validates findings (mocked).
jest.mock('@/helpers/compliance-review-engine', () => ({
  ReviewOutputSchema: jest.requireActual('@/helpers/compliance-review-engine').ReviewOutputSchema,
}));

const mockValidate = jest.fn();
jest.mock('@/helpers/compliance-review-validate', () => ({
  validateAndTagFindings: (...a: unknown[]) => mockValidate(...a),
}));

const mockSavePair = jest.fn();
const mockListHistory = jest.fn();
jest.mock('@/helpers/compliance-review', () => ({
  saveComplianceMessagePair: (...a: unknown[]) => mockSavePair(...a),
  listComplianceReviewHistory: (...a: unknown[]) => mockListHistory(...a),
}));

jest.mock('@/helpers/audit-log', () => ({ writeAuditLog: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/helpers/secret', () => ({ getHmacSecret: jest.fn().mockResolvedValue('secret') }));

import { baseHandler } from './chat';
import { makeComplianceToolExecutor } from '@/helpers/compliance-review-tools';

const mockMakeExecutor = makeComplianceToolExecutor as unknown as jest.Mock;

const query = { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' };
const makeEvent = (body: unknown) =>
  ({
    queryStringParameters: query,
    body: JSON.stringify(body),
    auth: { userId: 'user-9', claims: { name: 'Jane' } },
    requestContext: { http: { sourceIp: '1.2.3.4' } },
    headers: { 'user-agent': 'jest' },
  }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetOpportunity.mockResolvedValue({ oppId: 'opp-1' });
  mockCreateProposalRun.mockResolvedValue({ runId: 'run-1' });
  mockEnqueue.mockResolvedValue(undefined);
  mockValidate.mockResolvedValue([]); // validated findings (default: none)
  mockSavePair.mockResolvedValue({ assistantMsg: { messageId: 'msg-1' } });
  mockListHistory.mockResolvedValue([]); // no prior turns by default
  // Default model output: a REVIEW answer with no findings.
  mockInvoke.mockResolvedValue({ answer: 'Here is what I found.', findings: [] });
});

describe('package-edit chat handler', () => {
  it('returns 400 when query params are missing', async () => {
    const res = await baseHandler({ queryStringParameters: {}, body: '{}' } as never);
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 on an empty message', async () => {
    const res = await baseHandler(makeEvent({ message: '' }));
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('SG-1: returns 400 (not 500) on malformed JSON body', async () => {
    const res = await baseHandler({ queryStringParameters: query, body: '{not json' } as never);
    expect((res as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 404 when the opportunity is missing', async () => {
    mockGetOpportunity.mockResolvedValueOnce(null);
    const res = await baseHandler(makeEvent({ message: 'hi' }));
    expect((res as { statusCode: number }).statusCode).toBe(404);
  });

  it('REVIEW turn → single loop, validates findings, persists, returns findings, no run created', async () => {
    // One model loop returns an answer + raw findings; the handler validates them.
    mockInvoke.mockResolvedValueOnce({ answer: 'The cost is $2.0M.', findings: [{ title: 'raw' }] });
    mockValidate.mockResolvedValueOnce([
      {
        findingId: 'F-1',
        fingerprint: 'fp1',
        targetKind: 'RFP_DOCUMENT',
        issueType: 'INCONSISTENCY',
        severity: 'major',
        title: 'x',
        description: 'd',
        anchorValid: false,
      },
    ]);
    const res = await baseHandler(makeEvent({ message: 'what is the cost?' }));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.intent).toBe('REVIEW');
    expect(body.answer).toBe('The cost is $2.0M.');
    expect(body.findings).toHaveLength(1);
    expect(mockValidate).toHaveBeenCalled();
    // Persisted to the shared compliance history (unified stream).
    expect(mockSavePair).toHaveBeenCalledWith(
      expect.objectContaining({ userMessage: 'what is the cost?', assistantAnswer: 'The cost is $2.0M.' }),
    );
    expect(mockCreateProposalRun).not.toHaveBeenCalled();
    expect(mockEnqueue).not.toHaveBeenCalled();
  });

  it('threads projectId into the compliance tool executor so verify_company_facts is project-scoped', async () => {
    // Regression: chat built the executor without projectId, so KB search ran
    // unscoped and the whole solution_plan source was skipped. projectId is in
    // scope and must be passed.
    await baseHandler(makeEvent({ message: 'what is the cost?' }));
    expect(mockMakeExecutor).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', oppId: 'opp-1', projectId: 'proj-1' }),
    );
  });

  it('CLARIFY → a plain answer (no findings, no propose_edits) is returned as-is, not swallowed', async () => {
    // The model declines to edit and asks a clarifying question in `answer`.
    mockInvoke.mockResolvedValueOnce({
      answer: 'That phone number looks incomplete (only 7 digits). What is the full number?',
      findings: [],
    });
    const res = await baseHandler(makeEvent({ message: 'change phone to 937-99-92' }));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.intent).toBe('REVIEW');
    expect(body.answer).toMatch(/looks incomplete/i);
    // Not the misleading "could not find enough" fallback.
    expect(body.answer).not.toMatch(/could not find enough/i);
    expect(mockCreateProposalRun).not.toHaveBeenCalled();
  });

  it('multi-turn: feeds recent history to the model so a follow-up resolves in context', async () => {
    mockListHistory.mockResolvedValueOnce([
      { role: 'user', content: 'Change phone to 666-66', createdAt: '2026-08-12T00:00:00.000Z' },
      { role: 'assistant', content: 'That number looks incomplete — are you sure?', createdAt: '2026-08-12T00:00:01.000Z' },
    ]);
    // On "Yes", the model (now seeing the prior turns) calls propose_edits.
    let seenUserPrompt = '';
    mockInvoke.mockImplementationOnce(async ({ user, toolExecutor }) => {
      seenUserPrompt = user;
      await toolExecutor('propose_edits', { instruction: 'Set the phone number to 666-66' }, 'tu-1');
      return { answer: '', findings: [] };
    });

    const res = await baseHandler(makeEvent({ message: 'Yes' }));
    expect((res as { statusCode: number }).statusCode).toBe(200);
    // Prior turns were included as context, and the current message is marked current.
    expect(seenUserPrompt).toMatch(/CONVERSATION SO FAR/);
    expect(seenUserPrompt).toContain('Change phone to 666-66');
    expect(seenUserPrompt).toContain('CURRENT message: "Yes"');
    expect(mockCreateProposalRun).toHaveBeenCalled();
  });

  it('EDIT turn → propose_edits called → creates a run and enqueues the worker (one loop)', async () => {
    // The model calls propose_edits during the single loop; then returns review JSON.
    mockInvoke.mockImplementationOnce(async ({ toolExecutor }) => {
      await toolExecutor('propose_edits', { instruction: 'Set total to $2.4M everywhere' }, 'tu-1');
      return { answer: '', findings: [] };
    });

    const res = await baseHandler(makeEvent({ message: 'make the total $2.4M everywhere' }));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.intent).toBe('EDIT');
    expect(body.runId).toBe('run-1');
    // The answer is the NEUTRAL in-flight message, not the model's speculative
    // sentence ("On it.") — the real result comes from the proposal list.
    expect(body.answer).toMatch(/Analyzing the package/i);
    expect(body.answer).not.toContain('On it.');
    expect(mockCreateProposalRun).toHaveBeenCalledWith(
      expect.objectContaining({ instruction: 'Set total to $2.4M everywhere' }),
    );
    expect(mockEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ runId: 'run-1' }),
    );
    // Persisted to the shared history with the run id so it renders inline.
    expect(mockSavePair).toHaveBeenCalledWith(
      expect.objectContaining({ editRunId: 'run-1' }),
    );
  });

  it('WR-1: still creates + enqueues the run when propose_edits fired but the final output parse throws', async () => {
    // The model calls propose_edits, then replies with prose the JSON parser
    // can't rescue → invokeClaudeWithTools throws. The captured instruction must
    // still drive the EDIT branch (no 500, run persisted).
    mockInvoke.mockImplementationOnce(async ({ toolExecutor }) => {
      await toolExecutor('propose_edits', { instruction: 'Set total to $2.4M everywhere' }, 'tu-1');
      throw new Error('[bedrock-tool-loop] Model failed to produce JSON output. Original response: Done, queued that...');
    });

    const res = await baseHandler(makeEvent({ message: 'make the total $2.4M everywhere' }));
    const body = JSON.parse((res as { body: string }).body);
    expect(body.intent).toBe('EDIT');
    expect(body.runId).toBe('run-1');
    expect(mockCreateProposalRun).toHaveBeenCalledWith(
      expect.objectContaining({ instruction: 'Set total to $2.4M everywhere' }),
    );
    expect(mockEnqueue).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1' }));
  });

  it('WR-1: rethrows the parse error when NO tool fired (a genuine review-output failure)', async () => {
    // No propose_edits call → nothing to salvage → the error surfaces (→ 5xx via
    // the error middleware), rather than being silently swallowed.
    mockInvoke.mockImplementationOnce(async () => {
      throw new Error('[bedrock-tool-loop] Model returned no text content after all rounds');
    });

    await expect(baseHandler(makeEvent({ message: 'is the cost right?' }))).rejects.toThrow(
      /no text content/i,
    );
    expect(mockCreateProposalRun).not.toHaveBeenCalled();
  });

  it('returns 409 when a proposal run is already active', async () => {
    mockCreateProposalRun.mockResolvedValueOnce(null);
    mockInvoke.mockImplementationOnce(async ({ toolExecutor }) => {
      await toolExecutor('propose_edits', { instruction: 'do it' }, 'tu-1');
      return { answer: '', findings: [] };
    });

    const res = await baseHandler(makeEvent({ message: 'change it everywhere' }));
    expect((res as { statusCode: number }).statusCode).toBe(409);
    expect(mockEnqueue).not.toHaveBeenCalled();
  });
});
