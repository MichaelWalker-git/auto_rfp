/**
 * Unit tests for assign-project-access handler.
 *
 * Verifies that org admins can assign project access without needing
 * explicit access themselves, and that project creators can also assign.
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

import { baseHandler } from './assign-project-access';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

// ── Helpers ─────────────────────────────────────────────────────────────

const parseBody = (response: { statusCode: number; body?: string }) =>
  response.body ? JSON.parse(response.body) : null;

const makeEvent = (overrides: Partial<AuthedEvent> = {}): AuthedEvent =>
  ({
    body: JSON.stringify({ userId: 'target-user', projectId: 'proj-1' }),
    headers: {},
    queryStringParameters: { orgId: 'org-1' },
    auth: { userId: 'admin-user', orgId: 'org-1', claims: {} },
    rbac: { role: 'ADMIN', permissions: ['project:edit'] },
    requestContext: { authorizer: {} },
    ...overrides,
  }) as unknown as AuthedEvent;

// ── Tests ───────────────────────────────────────────────────────────────

describe('assign-project-access', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  it('org admin can assign access without having explicit project access', async () => {
    // getProjectById returns a project (via ScanCommand)
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          partition_key: 'PROJECT',
          sort_key: 'org-1#proj-1',
          id: 'proj-1',
          orgId: 'org-1',
          createdBy: 'other-user',
        },
      ],
    });
    // getProjectById also fetches org
    mockSend.mockResolvedValueOnce({ Item: { id: 'org-1', name: 'Test Org' } });

    // assignProjectAccess PutCommand
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent();
    const result = await baseHandler(event);
    const body = parseBody(result as { statusCode: number; body: string });

    expect((result as { statusCode: number }).statusCode).toBe(201);
    expect(body.userId).toBe('target-user');
    expect(body.projectId).toBe('proj-1');
  });

  it('project creator can assign access even if not org admin', async () => {
    // getProjectById
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          partition_key: 'PROJECT',
          sort_key: 'org-1#proj-1',
          id: 'proj-1',
          orgId: 'org-1',
          createdBy: 'creator-user',
        },
      ],
    });
    mockSend.mockResolvedValueOnce({ Item: { id: 'org-1' } });

    // assignProjectAccess PutCommand
    mockSend.mockResolvedValueOnce({});

    const event = makeEvent({
      auth: { userId: 'creator-user', orgId: 'org-1', claims: {} },
      rbac: { role: 'EDITOR', permissions: ['project:edit'] },
    } as unknown as Partial<AuthedEvent>);

    const result = await baseHandler(event);
    expect((result as { statusCode: number }).statusCode).toBe(201);
  });

  it('non-admin non-creator gets 403', async () => {
    // getProjectById
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          partition_key: 'PROJECT',
          sort_key: 'org-1#proj-1',
          id: 'proj-1',
          orgId: 'org-1',
          createdBy: 'someone-else',
        },
      ],
    });
    mockSend.mockResolvedValueOnce({ Item: { id: 'org-1' } });

    const event = makeEvent({
      auth: { userId: 'random-user', orgId: 'org-1', claims: {} },
      rbac: { role: 'EDITOR', permissions: ['project:edit'] },
    } as unknown as Partial<AuthedEvent>);

    const result = await baseHandler(event);
    expect((result as { statusCode: number }).statusCode).toBe(403);
  });

  it('returns 400 for invalid body', async () => {
    const event = makeEvent({ body: JSON.stringify({ userId: '' }) });
    const result = await baseHandler(event);
    expect((result as { statusCode: number }).statusCode).toBe(400);
  });

  it('returns 404 if project not found', async () => {
    // getProjectById returns no items
    mockSend.mockResolvedValueOnce({ Items: [] });

    const event = makeEvent();
    const result = await baseHandler(event);
    expect((result as { statusCode: number }).statusCode).toBe(404);
  });
});