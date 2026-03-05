// Mock middy before importing handlers
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
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: jest.fn(() => ({ before: jest.fn() })),
  orgMembershipMiddleware: jest.fn(() => ({ before: jest.fn() })),
  requirePermission: jest.fn(() => ({ before: jest.fn() })),
  httpErrorMiddleware: jest.fn(() => ({ onError: jest.fn() })),
}));

jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ after: jest.fn(), onError: jest.fn() })),
  setAuditContext: jest.fn(),
}));

// Set required environment variables
process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';

import { baseHandler } from './get-apn-credentials';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import { setAuditContext } from '@/middleware/audit-middleware';

const makeEvent = (queryStringParameters: Record<string, string> = {}): AuthedEvent =>
  ({
    queryStringParameters,
    headers: { 'x-org-id': queryStringParameters['orgId'] },
    requestContext: { http: { sourceIp: '127.0.0.1' } },
    auth: { userId: 'user-123', claims: {}, orgId: queryStringParameters['orgId'] },
  } as unknown as AuthedEvent);

describe('get-apn-credentials handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('validation', () => {
    it('returns 400 when orgId is missing', async () => {
      const result = await baseHandler(makeEvent({}));
      expect(result).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('orgId');
    });
  });

  describe('happy path', () => {
    it('returns configured: false when no credentials exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await baseHandler(makeEvent({ orgId: 'org-1' }));
      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.configured).toBe(false);
    });

    it('returns configured: true with metadata when credentials exist', async () => {
      mockSend.mockResolvedValueOnce({
        Item: {
          orgId: 'org-1',
          partnerId: 'PARTNER001',
          region: 'us-east-1',
          configuredAt: '2025-01-01T00:00:00Z',
        },
      });

      const result = await baseHandler(makeEvent({ orgId: 'org-1' }));
      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.configured).toBe(true);
      expect(body.partnerId).toBe('PARTNER001');
      expect(body.region).toBe('us-east-1');
    });

    it('sets audit context for credential read', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      await baseHandler(makeEvent({ orgId: 'org-1' }));

      expect(setAuditContext).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'CONFIG_CHANGED',
          resource: 'config',
          resourceId: 'apn-credentials',
        }),
      );
    });
  });

  describe('error handling', () => {
    it('propagates DynamoDB errors', async () => {
      mockSend.mockRejectedValue(new Error('DynamoDB error'));

      await expect(
        baseHandler(makeEvent({ orgId: 'org-1' })),
      ).rejects.toThrow('DynamoDB error');
    });
  });
});
