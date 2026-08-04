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
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
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

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import type { APIGatewayProxyEventV2, APIGatewayProxyStructuredResultV2 } from 'aws-lambda';
import { baseHandler } from './get-prompts';
import { DocumentPromptTypeSchema } from '@auto-rfp/core';
import { getDefaultGuidance, getDefaultTask } from '@/helpers/document-prompts';
import { SYSTEM_PROMPT_PK } from '@/constants/prompt';

const ORG_ID = 'org-123';
const DOC_TYPE_COUNT = DocumentPromptTypeSchema.options.length;

const makeEvent = (orgId?: string): APIGatewayProxyEventV2 =>
  ({
    queryStringParameters: orgId ? { orgId } : {},
  }) as unknown as APIGatewayProxyEventV2;

const invoke = async (event: APIGatewayProxyEventV2) =>
  (await baseHandler(event)) as APIGatewayProxyStructuredResultV2;

const parseItems = (result: APIGatewayProxyStructuredResultV2) =>
  JSON.parse(result.body ?? '{}').items as {
    system: Array<Record<string, unknown>>;
    user: Array<Record<string, unknown>>;
    document: Array<Record<string, unknown>>;
  };

/** Queue query responses: first call = SYSTEM PK query, second = USER PK query. */
const mockQueries = (systemItems: unknown[], userItems: unknown[]) => {
  mockSend.mockImplementation((cmd: { params: { ExpressionAttributeValues: Record<string, string> } }) => {
    const pk = cmd.params.ExpressionAttributeValues[':pk'];
    return Promise.resolve({ Items: pk === SYSTEM_PROMPT_PK ? systemItems : userItems });
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockReset();
});

describe('get-prompts baseHandler', () => {
  it('returns 400 when orgId is missing', async () => {
    const result = await invoke(makeEvent());

    expect(result.statusCode).toBe(400);
  });

  it('splits rows into system, user, and document groups', async () => {
    const featureSystemRow = { type: 'ANSWER', scope: 'SYSTEM', prompt: 'custom answer', orgId: ORG_ID };
    const docSystemRow = { documentType: 'COST_PROPOSAL', scope: 'SYSTEM', prompt: 'custom guidance', orgId: ORG_ID };
    const docUserRow = { documentType: 'PRICE_VOLUME', scope: 'USER', prompt: 'custom task', orgId: ORG_ID };
    mockQueries([featureSystemRow, docSystemRow], [docUserRow]);

    const result = await invoke(makeEvent(ORG_ID));

    expect(result.statusCode).toBe(200);
    const { system, user, document } = parseItems(result);

    expect(system).toContainEqual(featureSystemRow);
    expect(system).not.toContainEqual(docSystemRow);
    expect(user).not.toContainEqual(docUserRow);
    expect(document).toContainEqual(docSystemRow);
    expect(document).toContainEqual(docUserRow);
  });

  it('synthesizes defaults for all document types across both scopes', async () => {
    mockQueries([], []);

    const result = await invoke(makeEvent(ORG_ID));

    const { document } = parseItems(result);
    expect(document).toHaveLength(DOC_TYPE_COUNT * 2);
    expect(document.every((d) => d.isDefault === true)).toBe(true);

    const costGuidance = document.find(
      (d) => d.documentType === 'COST_PROPOSAL' && d.scope === 'SYSTEM',
    );
    expect(costGuidance?.prompt).toBe(getDefaultGuidance('COST_PROPOSAL'));

    const costTask = document.find(
      (d) => d.documentType === 'COST_PROPOSAL' && d.scope === 'USER',
    );
    expect(costTask?.prompt).toBe(getDefaultTask('COST_PROPOSAL'));
  });

  it('suppresses the synthesized default for an overridden type+scope only', async () => {
    const override = { documentType: 'COVER_LETTER', scope: 'SYSTEM', prompt: 'my guidance', orgId: ORG_ID };
    mockQueries([override], []);

    const result = await invoke(makeEvent(ORG_ID));

    const { document } = parseItems(result);
    expect(document).toHaveLength(DOC_TYPE_COUNT * 2);

    const coverLetterSystem = document.filter(
      (d) => d.documentType === 'COVER_LETTER' && d.scope === 'SYSTEM',
    );
    expect(coverLetterSystem).toEqual([override]);

    // USER scope of the same type still gets its default
    const coverLetterUser = document.find(
      (d) => d.documentType === 'COVER_LETTER' && d.scope === 'USER',
    );
    expect(coverLetterUser?.isDefault).toBe(true);
  });

  it('no longer synthesizes the dead PROPOSAL feature type', async () => {
    mockQueries([], []);

    const result = await invoke(makeEvent(ORG_ID));

    const { system, user } = parseItems(result);
    expect(system.some((p) => p.type === 'PROPOSAL')).toBe(false);
    expect(user.some((p) => p.type === 'PROPOSAL')).toBe(false);
  });

  it('still returns a stored PROPOSAL row from the DB (data kept)', async () => {
    const legacyRow = { type: 'PROPOSAL', scope: 'SYSTEM', prompt: 'legacy', orgId: ORG_ID };
    mockQueries([legacyRow], []);

    const result = await invoke(makeEvent(ORG_ID));

    const { system } = parseItems(result);
    expect(system).toContainEqual(legacyRow);
  });

  it('still synthesizes feature defaults for types not in the DB', async () => {
    mockQueries([], []);

    const result = await invoke(makeEvent(ORG_ID));

    const { system, user } = parseItems(result);
    const answerDefault = system.find((p) => p.type === 'ANSWER');
    expect(answerDefault?.isDefault).toBe(true);
    expect(user.some((p) => p.type === 'ANSWER' && p.isDefault === true)).toBe(true);
  });
});
