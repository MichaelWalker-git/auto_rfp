/**
 * Tests for the AI section-edit handler, focused on document prompt override
 * wiring (DP-5): the org's guidance fragment must be injected into the edit
 * system prompt, falling back to the hardcoded default guidance when no
 * override exists.
 */

// Mock middy before importing handlers
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (h: unknown) => h,
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: jest.fn(() => ({ before: jest.fn() })),
  orgMembershipMiddleware: jest.fn(() => ({ before: jest.fn() })),
  requirePermission: jest.fn(() => ({ before: jest.fn() })),
  httpErrorMiddleware: jest.fn(() => ({ onError: jest.fn() })),
}));

jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({})),
  setAuditContext: jest.fn(),
}));

const mockGetRFPDocument = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  getRFPDocument: (...args: unknown[]) => mockGetRFPDocument(...args),
}));

const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: (...args: unknown[]) => mockInvokeModel(...args),
}));

const mockGetDocumentToolsForType = jest.fn(() => []);
jest.mock('@/helpers/document-tools', () => ({
  DOCUMENT_TOOLS: [],
  PRICING_TOOL_DOC_TYPES: new Set(['COST_PROPOSAL', 'PRICE_VOLUME']),
  getDocumentToolsForType: (...args: unknown[]) => mockGetDocumentToolsForType(...(args as [])),
  executeDocumentTool: jest.fn(),
}));

jest.mock('@/helpers/document-generation', () => ({
  loadQaPairs: jest.fn().mockResolvedValue([]),
  loadSolicitation: jest.fn().mockResolvedValue(''),
}));

const mockGetSolutionPlan = jest.fn();
jest.mock('@/helpers/solution-plan', () => ({
  getSolutionPlanByOpportunity: (...args: unknown[]) => mockGetSolutionPlan(...args),
}));

jest.mock('@/helpers/document-context', () => ({
  gatherAllContext: jest.fn().mockResolvedValue(''),
}));

jest.mock('@/helpers/ai-chat', () => ({
  listChatMessages: jest.fn().mockResolvedValue([]),
  saveChatMessages: jest.fn().mockResolvedValue(undefined),
}));

const mockResolveFragments = jest.fn();
jest.mock('@/helpers/document-prompt-overrides', () => ({
  resolveDocumentPromptFragments: (...args: unknown[]) => mockResolveFragments(...args),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler, buildSectionEditSystemPrompt } from './edit-section';
import { getDefaultGuidance } from '@/helpers/document-prompts';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const makeEvent = (bodyOverrides: Record<string, unknown> = {}): AuthedEvent =>
  ({
    body: JSON.stringify({
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      documentId: 'doc-1',
      sectionTitle: 'Approach',
      currentSectionHtml: '<h2>Approach</h2><p>Old content</p>',
      instruction: 'Make it stronger',
      ...bodyOverrides,
    }),
    queryStringParameters: { orgId: 'org-1' },
    headers: {},
    requestContext: { http: { sourceIp: '127.0.0.1' } },
    auth: { userId: 'user-1', claims: {}, orgId: 'org-1' },
  } as unknown as AuthedEvent);

const bedrockTextResponse = (text: string): Uint8Array =>
  new TextEncoder().encode(
    JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text }] }),
  );

/** Extract the system prompt text from the captured invokeModel request body. */
const sentSystemPrompt = (callIndex = 0): string => {
  const body = JSON.parse(mockInvokeModel.mock.calls[callIndex]![1] as string);
  return body.system[0].text as string;
};

/** Extract the last user-message text from the captured invokeModel request body. */
const sentUserPrompt = (callIndex = 0): string => {
  const body = JSON.parse(mockInvokeModel.mock.calls[callIndex]![1] as string);
  const userMessages = (body.messages as Array<{ role: string; content: Array<{ text?: string }> }>)
    .filter((m) => m.role === 'user');
  return userMessages[userMessages.length - 1]!.content.map((c) => c.text ?? '').join('\n');
};

describe('buildSectionEditSystemPrompt', () => {
  it('injects the guidance override into the DOCUMENT TYPE GUIDANCE section', () => {
    const prompt = buildSectionEditSystemPrompt('Approach', 'TECHNICAL_PROPOSAL', 'CUSTOM ORG GUIDANCE');

    expect(prompt).toContain('DOCUMENT TYPE GUIDANCE');
    expect(prompt).toContain('CUSTOM ORG GUIDANCE');
    expect(prompt).not.toContain(getDefaultGuidance('TECHNICAL_PROPOSAL'));
  });

  it('falls back to the hardcoded default guidance when no override is given', () => {
    const prompt = buildSectionEditSystemPrompt('Approach', 'TECHNICAL_PROPOSAL', null);

    expect(prompt).toContain(getDefaultGuidance('TECHNICAL_PROPOSAL'));
  });

  it('keeps the section-edit skeleton (output format, editing rules, tools) intact', () => {
    const prompt = buildSectionEditSystemPrompt('Approach', 'TECHNICAL_PROPOSAL', 'CUSTOM ORG GUIDANCE');

    expect(prompt).toContain('CRITICAL OUTPUT FORMAT');
    expect(prompt).toContain('EDITING RULES');
    expect(prompt).toContain('TOOL USAGE');
    expect(prompt).toContain('editing a SINGLE SECTION');
    expect(prompt).toContain('"Approach"');
  });
});

describe('edit-section handler — override wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSolutionPlan.mockResolvedValue(null);
    mockGetRFPDocument.mockResolvedValue({
      documentId: 'doc-1',
      documentType: 'COVER_LETTER',
    });
    mockResolveFragments.mockResolvedValue({ guidance: null, task: null });
    mockInvokeModel.mockResolvedValue(
      bedrockTextResponse('<h2>Approach</h2><p>Updated content</p>'),
    );
  });

  it('resolves fragments for the document type and injects the guidance override', async () => {
    mockResolveFragments.mockResolvedValue({ guidance: 'ORG GUIDANCE OVERRIDE', task: null });

    const result = await baseHandler(makeEvent());

    expect(result).toMatchObject({ statusCode: 200 });
    expect(mockResolveFragments).toHaveBeenCalledTimes(1);
    expect(mockResolveFragments).toHaveBeenCalledWith('org-1', 'COVER_LETTER');
    expect(sentSystemPrompt()).toContain('ORG GUIDANCE OVERRIDE');
  });

  it('uses the default guidance when no override exists', async () => {
    const result = await baseHandler(makeEvent());

    expect(result).toMatchObject({ statusCode: 200 });
    expect(sentSystemPrompt()).toContain(getDefaultGuidance('COVER_LETTER'));
  });

  it('defaults the document type to TECHNICAL_PROPOSAL when the document has none', async () => {
    mockGetRFPDocument.mockResolvedValue({ documentId: 'doc-1' });

    await baseHandler(makeEvent());

    expect(mockResolveFragments).toHaveBeenCalledWith('org-1', 'TECHNICAL_PROPOSAL');
  });

  it('returns 400 on invalid payload', async () => {
    const result = await baseHandler(makeEvent({ instruction: '' }));

    expect(result).toMatchObject({ statusCode: 400 });
    expect(mockResolveFragments).not.toHaveBeenCalled();
  });

  it('returns 404 when the document does not exist', async () => {
    mockGetRFPDocument.mockResolvedValue(null);

    const result = await baseHandler(makeEvent());

    expect(result).toMatchObject({ statusCode: 404 });
    expect(mockResolveFragments).not.toHaveBeenCalled();
  });

  it('returns the updated section HTML on success', async () => {
    const result = await baseHandler(makeEvent());

    const body = JSON.parse((result as { body: string }).body);
    expect(body.ok).toBe(true);
    expect(body.updatedHtml).toBe('<h2>Approach</h2><p>Updated content</p>');
  });

  it('threads the request orgId through to invokeModel as the third argument', async () => {
    await baseHandler(makeEvent());

    expect(mockInvokeModel).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'org-1',
    );
  });
});

describe('edit-section handler — Solution Plan pricing-tool gating (Fix A)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSolutionPlan.mockResolvedValue(null);
    mockResolveFragments.mockResolvedValue({ guidance: null, task: null });
    mockInvokeModel.mockResolvedValue(
      bedrockTextResponse('<h2>Approach</h2><p>Updated content</p>'),
    );
  });

  it('withholds the pricing tool when the document carries an ADR-7 solutionPlanId stamp', async () => {
    mockGetRFPDocument.mockResolvedValue({
      documentId: 'doc-1',
      documentType: 'COST_PROPOSAL',
      solutionPlanId: 'plan-1',
    });

    await baseHandler(makeEvent());

    expect(mockGetDocumentToolsForType).toHaveBeenCalledWith('COST_PROPOSAL', {
      hasSolutionPlan: true,
    });
  });

  it('offers the pricing tool when the document has no solutionPlanId stamp', async () => {
    mockGetRFPDocument.mockResolvedValue({
      documentId: 'doc-1',
      documentType: 'COST_PROPOSAL',
      solutionPlanId: null,
    });

    await baseHandler(makeEvent());

    expect(mockGetDocumentToolsForType).toHaveBeenCalledWith('COST_PROPOSAL', {
      hasSolutionPlan: false,
    });
  });
});

describe('edit-section handler — pricing-table math auto-correction (Fix B)', () => {
  const WRONG_TOTAL_TABLE =
    '<h2>Pricing</h2><table>' +
    '<tr><th>Service</th><th>Price</th></tr>' +
    '<tr><td>Datadog Pro</td><td>$100.00</td></tr>' +
    '<tr><td>GitHub Enterprise</td><td>$250.00</td></tr>' +
    '<tr><td>Total</td><td>$275.00</td></tr>' +
    '</table>';

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSolutionPlan.mockResolvedValue(null);
    mockResolveFragments.mockResolvedValue({ guidance: null, task: null });
    mockInvokeModel.mockResolvedValue(bedrockTextResponse(WRONG_TOTAL_TABLE));
  });

  it('auto-corrects a wrong table total for pricing document types', async () => {
    mockGetRFPDocument.mockResolvedValue({ documentId: 'doc-1', documentType: 'COST_PROPOSAL' });

    const result = await baseHandler(makeEvent({ sectionTitle: 'Pricing' }));

    const body = JSON.parse((result as { body: string }).body);
    expect(body.updatedHtml).toContain('$350.00');
    expect(body.updatedHtml).not.toContain('$275.00');
  });

  it('leaves non-pricing document types untouched', async () => {
    mockGetRFPDocument.mockResolvedValue({ documentId: 'doc-1', documentType: 'TECHNICAL_PROPOSAL' });

    const result = await baseHandler(makeEvent({ sectionTitle: 'Pricing' }));

    const body = JSON.parse((result as { body: string }).body);
    expect(body.updatedHtml).toContain('$275.00');
  });
});

describe('edit-section handler — plan-governed pricing rules & reconciliation', () => {
  const costSchedule = {
    currency: 'USD',
    items: [{ label: 'Implementation', category: 'LABOR', amount: 34720, billing: 'ONE_TIME' }],
    oneTimeTotal: 34720,
    ongoingAnnualTotal: 0,
  };

  const readyPlanWithSchedule = {
    id: 'plan-1',
    status: 'READY',
    version: 3,
    costSchedule,
  };

  // Fix B corrects $275 → $350; the plan reconciliation then forces the
  // bucket-labeled total to the schedule value — proving pass order.
  const WRONG_TOTAL_TABLE =
    '<h2>Pricing</h2><table>' +
    '<tr><td>Setup</td><td>$100.00</td></tr>' +
    '<tr><td>Migration</td><td>$250.00</td></tr>' +
    '<tr><td>Total One-Time Costs</td><td>$275.00</td></tr>' +
    '</table>';

  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveFragments.mockResolvedValue({ guidance: null, task: null });
    mockGetSolutionPlan.mockResolvedValue(readyPlanWithSchedule);
    mockGetRFPDocument.mockResolvedValue({
      documentId: 'doc-1',
      documentType: 'COST_PROPOSAL',
      solutionPlanId: 'plan-1',
    });
    mockInvokeModel.mockResolvedValue(bedrockTextResponse(WRONG_TOTAL_TABLE));
  });

  it('appends the mandatory pricing rules block to the section-edit system prompt (previously missing)', async () => {
    await baseHandler(makeEvent({ sectionTitle: 'Pricing' }));

    const prompt = sentSystemPrompt();
    expect(prompt).toContain('MANDATORY PRICING RULES');
    // Plan-stamped document → plan-present variant with the plan-governed rules
    expect(prompt).toContain('PLAN-GOVERNED COSTS');
  });

  it('does not add pricing rules for non-pricing document types', async () => {
    mockGetRFPDocument.mockResolvedValue({ documentId: 'doc-1', documentType: 'COVER_LETTER' });

    await baseHandler(makeEvent());

    expect(sentSystemPrompt()).not.toContain('MANDATORY PRICING RULES');
    expect(mockGetSolutionPlan).not.toHaveBeenCalled();
  });

  it('injects the AUTHORITATIVE COST SCHEDULE block into the section-edit user prompt', async () => {
    await baseHandler(makeEvent({ sectionTitle: 'Pricing' }));

    const prompt = sentUserPrompt();
    expect(prompt).toContain('AUTHORITATIVE COST SCHEDULE (SOURCE OF TRUTH — COPY THESE NUMBERS EXACTLY)');
    expect(prompt).toContain('TOTAL ONE-TIME: $34,720.00');
  });

  it('forces the plan totals AFTER the Fix B pass (last writer)', async () => {
    const result = await baseHandler(makeEvent({ sectionTitle: 'Pricing' }));

    const body = JSON.parse((result as { body: string }).body);
    expect(body.updatedHtml).toContain('$34,720.00'); // plan value, not Fix B's $350
    expect(body.updatedHtml).not.toContain('$275.00');
    expect(body.updatedHtml).not.toContain('>$350.00');
  });

  it('skips schedule injection and reconciliation when the document has no plan stamp', async () => {
    mockGetRFPDocument.mockResolvedValue({
      documentId: 'doc-1',
      documentType: 'COST_PROPOSAL',
      solutionPlanId: null,
    });

    const result = await baseHandler(makeEvent({ sectionTitle: 'Pricing' }));

    expect(sentUserPrompt()).not.toContain('AUTHORITATIVE COST SCHEDULE');
    const body = JSON.parse((result as { body: string }).body);
    expect(body.updatedHtml).toContain('$350.00'); // Fix B only
  });

  it('falls back to Fix A behavior when the plan has no schedule (legacy / user-edited)', async () => {
    mockGetSolutionPlan.mockResolvedValue({ ...readyPlanWithSchedule, costSchedule: null });

    const result = await baseHandler(makeEvent({ sectionTitle: 'Pricing' }));

    expect(sentUserPrompt()).not.toContain('AUTHORITATIVE COST SCHEDULE');
    const body = JSON.parse((result as { body: string }).body);
    expect(body.updatedHtml).toContain('$350.00');
  });

  it('never fails the edit when the plan load rejects', async () => {
    mockGetSolutionPlan.mockRejectedValue(new Error('DynamoDB down'));

    const result = await baseHandler(makeEvent({ sectionTitle: 'Pricing' }));

    expect(result).toMatchObject({ statusCode: 200 });
  });
});
