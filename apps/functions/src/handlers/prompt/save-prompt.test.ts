// Mock middy before importing handlers (ESM compatibility)
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

// Mock AWS SDK
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
  DeleteCommand: jest.fn((params) => ({ type: 'Delete', params })),
}));

// Mock audit middleware
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ before: jest.fn(), after: jest.fn() })),
  setAuditContext: jest.fn(),
}));

// Mock RBAC middleware
jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: jest.fn(() => ({ before: jest.fn() })),
  orgMembershipMiddleware: jest.fn(() => ({ before: jest.fn() })),
  requirePermission: jest.fn(() => ({ before: jest.fn() })),
  httpErrorMiddleware: jest.fn(() => ({ onError: jest.fn() })),
}));

// Mock sentry
jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: jest.fn((handler: unknown) => handler),
}));

// Mock prompt helpers
jest.mock('@/helpers/prompt', () => ({
  saveSystemPrompt: jest.fn(),
  saveUserPrompt: jest.fn(),
  saveDocumentPrompt: jest.fn(),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { baseHandler } from './save-prompt';
import { saveDocumentPrompt, saveSystemPrompt, saveUserPrompt } from '@/helpers/prompt';
import { setAuditContext } from '@/middleware/audit-middleware';
import { DOCUMENT_PROMPT_MAX_LENGTH } from '@auto-rfp/core';

const mockSaveSystemPrompt = saveSystemPrompt as jest.MockedFunction<typeof saveSystemPrompt>;
const mockSaveUserPrompt = saveUserPrompt as jest.MockedFunction<typeof saveUserPrompt>;
const mockSaveDocumentPrompt = saveDocumentPrompt as jest.MockedFunction<typeof saveDocumentPrompt>;

const ORG_ID = 'org-123';

const makeEvent = (scope: string, body: unknown): APIGatewayProxyEventV2 =>
  ({
    pathParameters: { scope },
    queryStringParameters: { orgId: ORG_ID },
    body: JSON.stringify(body),
  }) as unknown as APIGatewayProxyEventV2;

const invoke = async (event: APIGatewayProxyEventV2) =>
  (await baseHandler(event)) as APIGatewayProxyStructuredResultV2;

const parseBody = (result: APIGatewayProxyStructuredResultV2) => JSON.parse(result.body ?? '{}');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('save-prompt baseHandler — document prompt path', () => {
  it('saves a document prompt when body carries documentType', async () => {
    const saved = {
      prompt: 'Custom guidance',
      documentType: 'COST_PROPOSAL',
      scope: 'SYSTEM',
      orgId: ORG_ID,
    };
    mockSaveDocumentPrompt.mockResolvedValueOnce(saved);

    const result = await invoke(
      makeEvent('SYSTEM', { documentType: 'COST_PROPOSAL', prompt: 'Custom guidance' }),
    );

    expect(result.statusCode).toBe(200);
    expect(mockSaveDocumentPrompt).toHaveBeenCalledWith(ORG_ID, 'SYSTEM', 'COST_PROPOSAL', 'Custom guidance');
    expect(mockSaveSystemPrompt).not.toHaveBeenCalled();
    expect(mockSaveUserPrompt).not.toHaveBeenCalled();
    expect(parseBody(result)).toEqual({ ok: true, item: saved });
  });

  it('routes USER scope to saveDocumentPrompt with USER', async () => {
    mockSaveDocumentPrompt.mockResolvedValueOnce({
      prompt: 'Custom task',
      documentType: 'PRICE_VOLUME',
      scope: 'USER',
      orgId: ORG_ID,
    });

    const result = await invoke(
      makeEvent('USER', { documentType: 'PRICE_VOLUME', prompt: 'Custom task' }),
    );

    expect(result.statusCode).toBe(200);
    expect(mockSaveDocumentPrompt).toHaveBeenCalledWith(ORG_ID, 'USER', 'PRICE_VOLUME', 'Custom task');
  });

  it('rejects prompts longer than the max length with 400', async () => {
    const result = await invoke(
      makeEvent('SYSTEM', {
        documentType: 'COST_PROPOSAL',
        prompt: 'x'.repeat(DOCUMENT_PROMPT_MAX_LENGTH + 1),
      }),
    );

    expect(result.statusCode).toBe(400);
    expect(mockSaveDocumentPrompt).not.toHaveBeenCalled();
  });

  it('rejects unknown documentType with 400', async () => {
    const result = await invoke(
      makeEvent('SYSTEM', { documentType: 'NOT_A_TYPE', prompt: 'text' }),
    );

    expect(result.statusCode).toBe(400);
    expect(mockSaveDocumentPrompt).not.toHaveBeenCalled();
  });

  it('rejects empty prompt with 400', async () => {
    const result = await invoke(
      makeEvent('SYSTEM', { documentType: 'COST_PROPOSAL', prompt: '' }),
    );

    expect(result.statusCode).toBe(400);
    expect(mockSaveDocumentPrompt).not.toHaveBeenCalled();
  });

  it('sets the audit context on success', async () => {
    mockSaveDocumentPrompt.mockResolvedValueOnce({
      prompt: 'p',
      documentType: 'APPENDICES',
      scope: 'SYSTEM',
      orgId: ORG_ID,
    });

    await invoke(makeEvent('SYSTEM', { documentType: 'APPENDICES', prompt: 'p' }));

    expect(setAuditContext).toHaveBeenCalledWith(expect.anything(), {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: 'prompt',
    });
  });

  it('returns 500 when the saved item fails validation', async () => {
    mockSaveDocumentPrompt.mockResolvedValueOnce({ documentType: 'BROKEN' });

    const result = await invoke(
      makeEvent('SYSTEM', { documentType: 'COST_PROPOSAL', prompt: 'text' }),
    );

    expect(result.statusCode).toBe(500);
    expect(parseBody(result).ok).toBe(false);
  });
});

describe('save-prompt baseHandler — feature prompt path (regression)', () => {
  it('still saves a SYSTEM feature prompt when body has type', async () => {
    const saved = { prompt: 'Feature prompt', type: 'ANSWER', orgId: ORG_ID, params: [] };
    mockSaveSystemPrompt.mockResolvedValueOnce(saved);

    const result = await invoke(makeEvent('SYSTEM', { type: 'ANSWER', prompt: 'Feature prompt' }));

    expect(result.statusCode).toBe(200);
    expect(mockSaveSystemPrompt).toHaveBeenCalledWith(ORG_ID, 'ANSWER', 'Feature prompt', undefined);
    expect(mockSaveDocumentPrompt).not.toHaveBeenCalled();
  });

  it('still saves a USER feature prompt', async () => {
    const saved = { prompt: 'Feature prompt', type: 'SUMMARY', orgId: ORG_ID, params: ['a'] };
    mockSaveUserPrompt.mockResolvedValueOnce(saved);

    const result = await invoke(
      makeEvent('USER', { type: 'SUMMARY', prompt: 'Feature prompt', params: ['a'] }),
    );

    expect(result.statusCode).toBe(200);
    expect(mockSaveUserPrompt).toHaveBeenCalledWith(ORG_ID, 'SUMMARY', 'Feature prompt', ['a']);
  });

  it('rejects invalid feature body with 400', async () => {
    const result = await invoke(makeEvent('SYSTEM', { type: 'NOT_A_TYPE', prompt: 'text' }));

    expect(result.statusCode).toBe(400);
  });
});

describe('save-prompt baseHandler — common validation', () => {
  it('returns 400 when orgId is missing', async () => {
    const event = {
      pathParameters: { scope: 'SYSTEM' },
      body: JSON.stringify({ documentType: 'COST_PROPOSAL', prompt: 'p' }),
    } as unknown as APIGatewayProxyEventV2;

    const result = await invoke(event);

    expect(result.statusCode).toBe(400);
  });

  it('returns 400 for an invalid scope', async () => {
    const result = await invoke(
      makeEvent('GLOBAL', { documentType: 'COST_PROPOSAL', prompt: 'p' }),
    );

    expect(result.statusCode).toBe(400);
  });

  it('returns 400 for invalid JSON body', async () => {
    const event = {
      pathParameters: { scope: 'SYSTEM' },
      queryStringParameters: { orgId: ORG_ID },
      body: '{not json',
    } as unknown as APIGatewayProxyEventV2;

    const result = await invoke(event);

    expect(result.statusCode).toBe(400);
  });
});
