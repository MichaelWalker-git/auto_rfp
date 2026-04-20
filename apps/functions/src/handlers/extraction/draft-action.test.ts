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
  GetCommand: jest.fn((params: unknown) => ({ type: 'Get', params })),
  PutCommand: jest.fn((params: unknown) => ({ type: 'Put', params })),
  DeleteCommand: jest.fn((params: unknown) => ({ type: 'Delete', params })),
}));

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

const mockSetAuditContext = jest.fn();
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ before: jest.fn(), after: jest.fn() })),
  setAuditContext: mockSetAuditContext,
}));

// Mock the extraction helper functions directly
const mockConfirmDraftPastProject = jest.fn();
const mockConfirmDraftLaborRate = jest.fn();
const mockConfirmDraftBOMItem = jest.fn();
const mockDiscardDraft = jest.fn();

jest.mock('@/helpers/extraction', () => ({
  confirmDraftPastProject: mockConfirmDraftPastProject,
  confirmDraftLaborRate: mockConfirmDraftLaborRate,
  confirmDraftBOMItem: mockConfirmDraftBOMItem,
  discardDraft: mockDiscardDraft,
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

// --- Now import baseHandler directly (no middy wrapper) ---
import { baseHandler } from './draft-action';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

// --- Test helpers ---
const TEST_ORG_ID = '11111111-1111-1111-1111-111111111111';
const TEST_USER_ID = '22222222-2222-2222-2222-222222222222';
const TEST_DRAFT_ID = '33333333-3333-3333-3333-333333333333';
const TEST_PROJECT_ID = '44444444-4444-4444-4444-444444444444';

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
      userId: TEST_USER_ID,
      userName: 'Test User',
      orgId: TEST_ORG_ID,
      claims: {},
    },
    ...overrides,
  }) as AuthedEvent;

const parseBody = (result: { body?: string }) => JSON.parse(result.body ?? '{}');

const mockPastProject = {
  projectId: TEST_PROJECT_ID,
  orgId: TEST_ORG_ID,
  title: 'Test Project',
  client: 'Test Client',
  description: 'Project description',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// --- Tests ---
describe('draft-action baseHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockConfirmDraftPastProject.mockReset();
    mockConfirmDraftLaborRate.mockReset();
    mockConfirmDraftBOMItem.mockReset();
    mockDiscardDraft.mockReset();
    mockSetAuditContext.mockReset();
  });

  describe('Confirm action', () => {
    it('should return 200 on successful confirm for PAST_PERFORMANCE', async () => {
      mockConfirmDraftPastProject.mockResolvedValueOnce(mockPastProject);

      const event = buildEvent({
        body: JSON.stringify({
          orgId: TEST_ORG_ID,
          draftId: TEST_DRAFT_ID,
          action: 'confirm',
          draftType: 'PAST_PERFORMANCE',
        }),
      });

      const result = await baseHandler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 200);
      expect(body.ok).toBe(true);
      expect(body.draftType).toBe('PAST_PERFORMANCE');
      expect(body.result.projectId).toBe(TEST_PROJECT_ID);
    });

    it('should return 200 on successful confirm for LABOR_RATE', async () => {
      mockConfirmDraftLaborRate.mockResolvedValueOnce({ laborRateId: 'rate-123' });

      const event = buildEvent({
        body: JSON.stringify({
          orgId: TEST_ORG_ID,
          draftId: TEST_DRAFT_ID,
          action: 'confirm',
          draftType: 'LABOR_RATE',
        }),
      });

      const result = await baseHandler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 200);
      expect(body.ok).toBe(true);
      expect(body.draftType).toBe('LABOR_RATE');
    });

    it('should return 200 on successful confirm for BOM_ITEM', async () => {
      mockConfirmDraftBOMItem.mockResolvedValueOnce({ bomItemId: 'bom-123' });

      const event = buildEvent({
        body: JSON.stringify({
          orgId: TEST_ORG_ID,
          draftId: TEST_DRAFT_ID,
          action: 'confirm',
          draftType: 'BOM_ITEM',
        }),
      });

      const result = await baseHandler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 200);
      expect(body.ok).toBe(true);
      expect(body.draftType).toBe('BOM_ITEM');
    });

    it('should set audit context on confirm', async () => {
      mockConfirmDraftPastProject.mockResolvedValueOnce(mockPastProject);

      const event = buildEvent({
        body: JSON.stringify({
          orgId: TEST_ORG_ID,
          draftId: TEST_DRAFT_ID,
          action: 'confirm',
          draftType: 'PAST_PERFORMANCE',
        }),
      });

      await baseHandler(event);

      expect(mockSetAuditContext).toHaveBeenCalledWith(
        event,
        expect.objectContaining({
          action: 'EXTRACTION_DRAFT_CONFIRMED',
          resource: 'past_project',
          resourceId: TEST_DRAFT_ID,
        }),
      );
    });

    it('should return 404 when draft not found', async () => {
      mockConfirmDraftPastProject.mockResolvedValueOnce(null);

      const event = buildEvent({
        body: JSON.stringify({
          orgId: TEST_ORG_ID,
          draftId: TEST_DRAFT_ID,
          action: 'confirm',
        }),
      });

      const result = await baseHandler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 404);
      expect(body.ok).toBe(false);
      expect(body.error).toContain('not found');
    });
  });

  describe('Discard action', () => {
    it('should return 200 on successful discard', async () => {
      mockDiscardDraft.mockResolvedValueOnce(true);

      const event = buildEvent({
        body: JSON.stringify({
          orgId: TEST_ORG_ID,
          draftId: TEST_DRAFT_ID,
          action: 'discard',
          draftType: 'PAST_PERFORMANCE',
        }),
      });

      const result = await baseHandler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 200);
      expect(body.ok).toBe(true);
      expect(body.message).toContain('discarded');
    });

    it('should set audit context on discard', async () => {
      mockDiscardDraft.mockResolvedValueOnce(true);

      const event = buildEvent({
        body: JSON.stringify({
          orgId: TEST_ORG_ID,
          draftId: TEST_DRAFT_ID,
          action: 'discard',
          draftType: 'PAST_PERFORMANCE',
        }),
      });

      await baseHandler(event);

      expect(mockSetAuditContext).toHaveBeenCalledWith(
        event,
        expect.objectContaining({
          action: 'EXTRACTION_DRAFT_DISCARDED',
          resource: 'past_project',
          resourceId: TEST_DRAFT_ID,
        }),
      );
    });

    it('should return 404 when draft not found for discard', async () => {
      mockDiscardDraft.mockResolvedValueOnce(false);

      const event = buildEvent({
        body: JSON.stringify({
          orgId: TEST_ORG_ID,
          draftId: TEST_DRAFT_ID,
          action: 'discard',
        }),
      });

      const result = await baseHandler(event);

      expect(result).toHaveProperty('statusCode', 404);
    });
  });

  describe('Validation errors', () => {
    it('should return 400 when orgId is missing', async () => {
      const event = buildEvent({
        body: JSON.stringify({
          draftId: TEST_DRAFT_ID,
          action: 'confirm',
        }),
      });

      const result = await baseHandler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 400);
      expect(body.ok).toBe(false);
    });

    it('should return 400 when draftId is missing', async () => {
      const event = buildEvent({
        body: JSON.stringify({
          orgId: TEST_ORG_ID,
          action: 'confirm',
        }),
      });

      const result = await baseHandler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 400);
      expect(body.ok).toBe(false);
    });

    it('should return 400 when action is invalid', async () => {
      const event = buildEvent({
        body: JSON.stringify({
          orgId: TEST_ORG_ID,
          draftId: TEST_DRAFT_ID,
          action: 'invalid_action',
        }),
      });

      const result = await baseHandler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 400);
      expect(body.ok).toBe(false);
    });

    it('should return 400 when action is missing', async () => {
      const event = buildEvent({
        body: JSON.stringify({
          orgId: TEST_ORG_ID,
          draftId: TEST_DRAFT_ID,
        }),
      });

      const result = await baseHandler(event);

      expect(result).toHaveProperty('statusCode', 400);
    });

    it('should return 400 when draftType is invalid', async () => {
      const event = buildEvent({
        body: JSON.stringify({
          orgId: TEST_ORG_ID,
          draftId: TEST_DRAFT_ID,
          action: 'confirm',
          draftType: 'INVALID_TYPE',
        }),
      });

      const result = await baseHandler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 400);
      expect(body.ok).toBe(false);
    });
  });

  describe('Default draftType', () => {
    it('should default to PAST_PERFORMANCE when draftType not specified', async () => {
      mockConfirmDraftPastProject.mockResolvedValueOnce(mockPastProject);

      const event = buildEvent({
        body: JSON.stringify({
          orgId: TEST_ORG_ID,
          draftId: TEST_DRAFT_ID,
          action: 'confirm',
        }),
      });

      const result = await baseHandler(event);
      const body = parseBody(result as { body: string });

      expect(result).toHaveProperty('statusCode', 200);
      expect(body.draftType).toBe('PAST_PERFORMANCE');
      expect(mockConfirmDraftPastProject).toHaveBeenCalled();
    });
  });
});
