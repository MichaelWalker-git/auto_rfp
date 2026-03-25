jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: jest.fn() })),
  },
}));

const mockGetItem = jest.fn();
const mockUpdateItem = jest.fn();
jest.mock('@/helpers/db', () => ({
  docClient: { send: jest.fn() },
  getItem: (...args: unknown[]) => mockGetItem(...args),
  updateItem: (...args: unknown[]) => mockUpdateItem(...args),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({ before: jest.fn() }),
  httpErrorMiddleware: () => ({ onError: jest.fn() }),
  orgMembershipMiddleware: () => ({ before: jest.fn() }),
}));

jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: () => ({ after: jest.fn() }),
  setAuditContext: jest.fn(),
}));

jest.mock('@/helpers/date', () => ({
  nowIso: () => '2025-01-01T00:00:00.000Z',
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { baseHandler } from './bulk-approve';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const makeEvent = (body: Record<string, unknown>, orgId = 'org-111'): AuthedEvent =>
  ({
    queryStringParameters: orgId ? { orgId } : {},
    body: JSON.stringify(body),
    headers: {},
    auth: { userId: 'user-999', userName: 'Test User' },
    requestContext: { http: { sourceIp: '127.0.0.1' } },
  }) as unknown as AuthedEvent;

const parseBody = (result: unknown) => {
  const r = result as { body?: string };
  return JSON.parse(r.body ?? '{}');
};

describe('bulk-approve handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItem.mockReset();
    mockUpdateItem.mockReset();
  });

  it('returns 400 when orgId is missing', async () => {
    const event = makeEvent({ itemIds: ['11111111-1111-1111-1111-111111111111'] }, '');
    const result = await baseHandler(event);
    const body = parseBody(result);
    expect(body.error).toBe('orgId is required');
  });

  it('returns 400 when body is invalid (empty itemIds)', async () => {
    const event = makeEvent({ itemIds: [] });
    const result = await baseHandler(event);
    const body = parseBody(result);
    expect(body.error).toBe('Invalid request body');
  });

  it('returns 400 when body is invalid (non-uuid itemIds)', async () => {
    const event = makeEvent({ itemIds: ['not-a-uuid'] });
    const result = await baseHandler(event);
    const body = parseBody(result);
    expect(body.error).toBe('Invalid request body');
  });

  it('approves items successfully', async () => {
    const itemId = '11111111-1111-1111-1111-111111111111';

    mockGetItem.mockResolvedValueOnce({
      id: itemId,
      approvalStatus: 'DRAFT',
      isArchived: false,
    });
    mockUpdateItem.mockResolvedValueOnce({});

    const event = makeEvent({ itemIds: [itemId] });
    const result = await baseHandler(event);
    const body = parseBody(result);

    expect(body.message).toContain('1 approved');
    expect(body.results).toHaveLength(1);
    expect(body.results[0].success).toBe(true);
    expect(mockUpdateItem).toHaveBeenCalledWith(
      'CONTENT_LIBRARY',
      `org-111#${itemId}`,
      expect.objectContaining({
        approvalStatus: 'APPROVED',
        approvedBy: 'user-999',
        approvedAt: '2025-01-01T00:00:00.000Z',
      }),
    );
  });

  it('skips already approved items (counts as success)', async () => {
    const itemId = '22222222-2222-2222-2222-222222222222';

    mockGetItem.mockResolvedValueOnce({
      id: itemId,
      approvalStatus: 'APPROVED',
      isArchived: false,
    });

    const event = makeEvent({ itemIds: [itemId] });
    const result = await baseHandler(event);
    const body = parseBody(result);

    expect(body.results[0].success).toBe(true);
    expect(mockUpdateItem).not.toHaveBeenCalled();
  });

  it('fails for archived items', async () => {
    const itemId = '33333333-3333-3333-3333-333333333333';

    mockGetItem.mockResolvedValueOnce({
      id: itemId,
      approvalStatus: 'DRAFT',
      isArchived: true,
    });

    const event = makeEvent({ itemIds: [itemId] });
    const result = await baseHandler(event);
    const body = parseBody(result);

    expect(body.results[0].success).toBe(false);
    expect(body.results[0].error).toContain('archived');
    expect(mockUpdateItem).not.toHaveBeenCalled();
  });

  it('fails for items not found', async () => {
    const itemId = '44444444-4444-4444-4444-444444444444';

    mockGetItem.mockResolvedValueOnce(null);

    const event = makeEvent({ itemIds: [itemId] });
    const result = await baseHandler(event);
    const body = parseBody(result);

    expect(body.results[0].success).toBe(false);
    expect(body.results[0].error).toContain('not found');
  });

  it('handles mixed results (some succeed, some fail)', async () => {
    const goodId = '55555555-5555-5555-5555-555555555555';
    const badId = '66666666-6666-6666-6666-666666666666';

    // First item: found, DRAFT
    mockGetItem.mockResolvedValueOnce({
      id: goodId,
      approvalStatus: 'DRAFT',
      isArchived: false,
    });
    mockUpdateItem.mockResolvedValueOnce({});

    // Second item: not found
    mockGetItem.mockResolvedValueOnce(null);

    const event = makeEvent({ itemIds: [goodId, badId] });
    const result = await baseHandler(event);
    const body = parseBody(result);

    expect(body.message).toContain('1 approved');
    expect(body.message).toContain('1 failed');
    expect(body.results).toHaveLength(2);
    expect(body.results[0].success).toBe(true);
    expect(body.results[1].success).toBe(false);
  });
});
