/**
 * Unit tests for create-project handler.
 *
 * Verifies that project creation auto-assigns the creator.
 */

// ── Mocks (must be before imports) ─────────────────────────────────────

jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  DeleteCommand: jest.fn((params) => ({ type: 'Delete', params })),
  ScanCommand: jest.fn((params) => ({ type: 'Scan', params })),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (h: unknown) => h,
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({ before: jest.fn() }),
  httpErrorMiddleware: () => ({ onError: jest.fn() }),
  orgMembershipMiddleware: () => ({ before: jest.fn() }),
  requirePermission: () => ({ before: jest.fn() }),
}));

jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: () => ({ after: jest.fn() }),
  setAuditContext: jest.fn(),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

// ── Import after mocks ─────────────────────────────────────────────────

import { baseHandler } from './create-project';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

// ── Helpers ─────────────────────────────────────────────────────────────

const parseBody = (response: { statusCode: number; body?: string }) =>
  response.body ? JSON.parse(response.body) : null;

const makeEvent = (overrides: Partial<AuthedEvent> = {}): AuthedEvent =>
  ({
    body: JSON.stringify({
      orgId: 'org-1',
      name: 'Test Project',
      description: 'A test project',
    }),
    headers: {},
    queryStringParameters: { orgId: 'org-1' },
    auth: { userId: 'creator-user', orgId: 'org-1', claims: {} },
    rbac: { role: 'EDITOR', permissions: ['project:create'] },
    requestContext: { authorizer: {} },
    ...overrides,
  }) as unknown as AuthedEvent;

// ── Tests ───────────────────────────────────────────────────────────────

describe('create-project', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  it('creates project and auto-assigns creator', async () => {
    // createItem (createProject) — PutCommand for the project
    mockSend.mockResolvedValueOnce({});

    // assignProjectAccess (creator) — PutCommand
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent();
    const result = await baseHandler(event);
    const body = parseBody(result as { statusCode: number; body: string });

    expect((result as { statusCode: number }).statusCode).toBe(201);
    expect(body.name).toBe('Test Project');
    expect(body.createdBy).toBe('creator-user');

    // Verify PutCommand was called twice (project + creator assignment)
    const putCalls = mockSend.mock.calls.filter(
      (call) => call[0]?.type === 'Put',
    );
    expect(putCalls.length).toBe(2);
  });

  it('returns 400 for missing body', async () => {
    const event = makeEvent({ body: undefined } as unknown as Partial<AuthedEvent>);
    const result = await baseHandler(event);
    expect((result as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const event = makeEvent({ body: 'not json' } as unknown as Partial<AuthedEvent>);
    const result = await baseHandler(event);
    expect((result as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 400 for missing required fields', async () => {
    const event = makeEvent({ body: JSON.stringify({ orgId: 'org-1' }) });
    const result = await baseHandler(event);
    expect((result as { statusCode: number }).statusCode).toBe(400);
  });
});