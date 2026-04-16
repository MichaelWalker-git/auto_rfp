// --- Mocks MUST come before imports ---

jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => {
    const wrapped = (...args: unknown[]) => (handler as (...args: unknown[]) => unknown)(...args);
    wrapped.use = jest.fn().mockReturnValue(wrapped);
    return wrapped;
  };
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
}));

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  QueryCommand: jest.fn((params: unknown) => ({ type: 'Query', params })),
}));

const mockListDraftRecords = jest.fn();
jest.mock('@/helpers/extraction', () => ({
  listDraftRecords: mockListDraftRecords,
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

// --- Now import baseHandler directly (no middy wrapper) ---
import { baseHandler } from './list-drafts';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

// --- Test helpers ---
const buildEvent = (overrides: Partial<AuthedEvent> = {}): AuthedEvent =>
  ({
    body: null,
    headers: {},
    queryStringParameters: null,
    pathParameters: null,
    requestContext: {
      http: { sourceIp: '127.0.0.1', userAgent: 'test' },
    } as AuthedEvent['requestContext'],
    auth: {
      userId: 'user-123',
      userName: 'Test User',
      orgId: 'org-123',
      claims: {},
    },
    ...overrides,
  }) as AuthedEvent;

const parseBody = (result: { body?: string }) => JSON.parse(result.body ?? '{}');

const mockPastPerfDraft = {
  projectId: 'draft-1',
  orgId: 'org-123',
  title: 'Test Project',
  client: 'Test Client',
  description: 'Description',
  draftStatus: 'DRAFT',
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-02-01T00:00:00.000Z',
};

const mockLaborRateDraft = {
  draftId: 'labor-draft-1',
  orgId: 'org-123',
  targetType: 'LABOR_RATE',
  position: 'Senior Developer',
  baseRate: 100,
  fullyLoadedRate: 150,
  draftStatus: 'DRAFT',
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-02-01T00:00:00.000Z',
};

// --- Tests ---
describe('list-drafts baseHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockListDraftRecords.mockReset();
  });

  describe('Happy path', () => {
    it('should return 200 with drafts for PAST_PERFORMANCE type', async () => {
      mockListDraftRecords.mockResolvedValueOnce([mockPastPerfDraft]);

      const event = buildEvent({
        queryStringParameters: { orgId: 'org-123', draftType: 'PAST_PERFORMANCE' },
      });

      const result = await baseHandler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 200);
      expect(body.ok).toBe(true);
      expect(body.drafts).toHaveLength(1);
      expect(body.count).toBe(1);
      expect(body.draftType).toBe('PAST_PERFORMANCE');
    });

    it('should return 200 with drafts for LABOR_RATE type', async () => {
      mockListDraftRecords.mockResolvedValueOnce([mockLaborRateDraft]);

      const event = buildEvent({
        queryStringParameters: { orgId: 'org-123', draftType: 'LABOR_RATE' },
      });

      const result = await baseHandler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 200);
      expect(body.draftType).toBe('LABOR_RATE');
      expect(body.drafts[0].position).toBe('Senior Developer');
    });

    it('should return empty array when no drafts exist', async () => {
      mockListDraftRecords.mockResolvedValueOnce([]);

      const event = buildEvent({
        queryStringParameters: { orgId: 'org-123' },
      });

      const result = await baseHandler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 200);
      expect(body.ok).toBe(true);
      expect(body.drafts).toHaveLength(0);
      expect(body.count).toBe(0);
    });

    it('should default to PAST_PERFORMANCE when draftType not specified', async () => {
      mockListDraftRecords.mockResolvedValueOnce([]);

      const event = buildEvent({
        queryStringParameters: { orgId: 'org-123' },
      });

      const result = await baseHandler(event);
      const body = parseBody(result as { body: string });

      expect(body.draftType).toBe('PAST_PERFORMANCE');
    });

    it('should filter by status when provided', async () => {
      mockListDraftRecords.mockResolvedValueOnce([mockPastPerfDraft]);

      const event = buildEvent({
        queryStringParameters: { orgId: 'org-123', status: 'DRAFT' },
      });

      const result = await baseHandler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 200);
      expect(body.drafts).toHaveLength(1);
    });
  });

  describe('Validation errors', () => {
    it('should return 400 when orgId is missing', async () => {
      const event = buildEvent({
        queryStringParameters: {},
      });

      const result = await baseHandler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 400);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('orgId');
    });

    it('should return 400 when draftType is invalid', async () => {
      const event = buildEvent({
        queryStringParameters: { orgId: 'org-123', draftType: 'INVALID_TYPE' },
      });

      const result = await baseHandler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 400);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('Invalid draftType');
    });
  });

  describe('Limit handling', () => {
    it('should respect limit parameter', async () => {
      mockListDraftRecords.mockResolvedValueOnce([mockPastPerfDraft]);

      const event = buildEvent({
        queryStringParameters: { orgId: 'org-123', limit: '5' },
      });

      const result = await baseHandler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 200);
      expect(body.ok).toBe(true);
      // Verify listDraftRecords was called with correct limit
      expect(mockListDraftRecords).toHaveBeenCalledWith('PAST_PERFORMANCE', 'org-123', undefined, 5);
    });

    it('should use default limit of 50 when not specified', async () => {
      mockListDraftRecords.mockResolvedValueOnce([]);

      const event = buildEvent({
        queryStringParameters: { orgId: 'org-123' },
      });

      await baseHandler(event);

      expect(mockListDraftRecords).toHaveBeenCalledWith('PAST_PERFORMANCE', 'org-123', undefined, 50);
    });
  });
});
