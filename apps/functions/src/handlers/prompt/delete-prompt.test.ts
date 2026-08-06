// Mock middy before importing handlers (ESM compatibility)
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

// Mock AWS SDK
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: jest.fn() })),
  },
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
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
  deleteDocumentPrompt: jest.fn(),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { baseHandler } from './delete-prompt';
import { deleteDocumentPrompt } from '@/helpers/prompt';
import { setAuditContext } from '@/middleware/audit-middleware';

const mockDeleteDocumentPrompt = deleteDocumentPrompt as jest.MockedFunction<typeof deleteDocumentPrompt>;

const ORG_ID = 'org-123';

const makeEvent = (scope: string, body: unknown): APIGatewayProxyEventV2 =>
  ({
    pathParameters: { scope },
    queryStringParameters: { orgId: ORG_ID },
    body: JSON.stringify(body),
  }) as unknown as APIGatewayProxyEventV2;

const invoke = async (event: APIGatewayProxyEventV2) =>
  (await baseHandler(event)) as APIGatewayProxyStructuredResultV2;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('delete-prompt baseHandler', () => {
  it('deletes the document prompt override and returns 200', async () => {
    mockDeleteDocumentPrompt.mockResolvedValueOnce(undefined);

    const result = await invoke(makeEvent('SYSTEM', { documentType: 'COST_PROPOSAL' }));

    expect(result.statusCode).toBe(200);
    expect(JSON.parse(result.body ?? '{}')).toEqual({ ok: true });
    expect(mockDeleteDocumentPrompt).toHaveBeenCalledWith(ORG_ID, 'SYSTEM', 'COST_PROPOSAL');
  });

  it('handles USER scope', async () => {
    mockDeleteDocumentPrompt.mockResolvedValueOnce(undefined);

    const result = await invoke(makeEvent('USER', { documentType: 'PRICE_VOLUME' }));

    expect(result.statusCode).toBe(200);
    expect(mockDeleteDocumentPrompt).toHaveBeenCalledWith(ORG_ID, 'USER', 'PRICE_VOLUME');
  });

  it('sets the audit context on success', async () => {
    mockDeleteDocumentPrompt.mockResolvedValueOnce(undefined);

    await invoke(makeEvent('SYSTEM', { documentType: 'APPENDICES' }));

    expect(setAuditContext).toHaveBeenCalledWith(expect.anything(), {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: 'prompt',
    });
  });

  it('returns 400 when orgId is missing', async () => {
    const event = {
      pathParameters: { scope: 'SYSTEM' },
      body: JSON.stringify({ documentType: 'COST_PROPOSAL' }),
    } as unknown as APIGatewayProxyEventV2;

    const result = await invoke(event);

    expect(result.statusCode).toBe(400);
    expect(mockDeleteDocumentPrompt).not.toHaveBeenCalled();
  });

  it('returns 400 for an invalid scope', async () => {
    const result = await invoke(makeEvent('GLOBAL', { documentType: 'COST_PROPOSAL' }));

    expect(result.statusCode).toBe(400);
    expect(mockDeleteDocumentPrompt).not.toHaveBeenCalled();
  });

  it('returns 400 for an unknown documentType', async () => {
    const result = await invoke(makeEvent('SYSTEM', { documentType: 'NOT_A_TYPE' }));

    expect(result.statusCode).toBe(400);
    expect(mockDeleteDocumentPrompt).not.toHaveBeenCalled();
  });

  it('returns 400 when documentType is missing', async () => {
    const result = await invoke(makeEvent('SYSTEM', {}));

    expect(result.statusCode).toBe(400);
    expect(mockDeleteDocumentPrompt).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid JSON body', async () => {
    const event = {
      pathParameters: { scope: 'SYSTEM' },
      queryStringParameters: { orgId: ORG_ID },
      body: '{not json',
    } as unknown as APIGatewayProxyEventV2;

    const result = await invoke(event);

    expect(result.statusCode).toBe(400);
    expect(mockDeleteDocumentPrompt).not.toHaveBeenCalled();
  });
});
