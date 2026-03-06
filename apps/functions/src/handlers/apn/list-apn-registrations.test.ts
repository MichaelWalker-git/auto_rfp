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
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
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

// Set required environment variables
process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';

import { baseHandler } from './list-apn-registrations';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const makeEvent = (queryStringParameters: Record<string, string> = {}): AuthedEvent =>
  ({
    queryStringParameters,
    headers: {},
    requestContext: { http: { sourceIp: '127.0.0.1' } },
    auth: { userId: 'user-123', claims: {} },
  } as unknown as AuthedEvent);

describe('list-apn-registrations handler', () => {
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
    it('returns empty list when no registrations exist', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await baseHandler(makeEvent({ orgId: 'org-1' }));
      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.items).toEqual([]);
      expect(body.count).toBe(0);
    });

    it('returns registrations sorted by createdAt descending', async () => {
      const older = {
        registrationId: 'reg-old',
        orgId: 'org-1',
        status: 'FAILED',
        createdAt: '2025-01-01T00:00:00Z',
      };
      const newer = {
        registrationId: 'reg-new',
        orgId: 'org-1',
        status: 'REGISTERED',
        createdAt: '2025-01-02T00:00:00Z',
      };
      mockSend.mockResolvedValueOnce({ Items: [older, newer] });

      const result = await baseHandler(makeEvent({ orgId: 'org-1' }));
      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.items).toHaveLength(2);
      expect(body.count).toBe(2);
      // Newest first
      expect(body.items[0].registrationId).toBe('reg-new');
      expect(body.items[1].registrationId).toBe('reg-old');
    });

    it('queries DynamoDB with correct PK and SK prefix', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await baseHandler(makeEvent({ orgId: 'org-1' }));

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            TableName: 'test-table',
            ExpressionAttributeValues: expect.objectContaining({
              ':pk': 'APN_REGISTRATION',
              ':skPrefix': 'org-1',
            }),
          }),
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
