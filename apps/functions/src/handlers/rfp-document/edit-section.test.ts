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

jest.mock('@/helpers/document-tools', () => ({
  DOCUMENT_TOOLS: [],
  getDocumentToolsForType: jest.fn(() => []),
  executeDocumentTool: jest.fn(),
}));

jest.mock('@/helpers/document-generation', () => ({
  loadQaPairs: jest.fn().mockResolvedValue([]),
  loadSolicitation: jest.fn().mockResolvedValue(''),
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
});
