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
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
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

import { baseHandler } from './get-apn-registration';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const makeEvent = (queryStringParameters: Record<string, string> = {}): AuthedEvent =>
  ({
    queryStringParameters,
    headers: {},
    requestContext: { http: { sourceIp: '127.0.0.1' } },
    auth: { userId: 'user-123', claims: {} },
  } as unknown as AuthedEvent);

describe('get-apn-registration handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('validation', () => {
    it('returns 400 when orgId is missing', async () => {
      const result = await baseHandler(makeEvent({ projectId: 'proj-1', oppId: 'opp-1' }));
      expect(result).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('orgId');
    });

    it('returns 400 when projectId is missing', async () => {
      const result = await baseHandler(makeEvent({ orgId: 'org-1', oppId: 'opp-1' }));
      expect(result).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('projectId');
    });

    it('returns 400 when oppId is missing', async () => {
      const result = await baseHandler(makeEvent({ orgId: 'org-1', projectId: 'proj-1' }));
      expect(result).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('oppId');
    });
  });

  describe('happy path', () => {
    it('returns null registration when none exists', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      const result = await baseHandler(
        makeEvent({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1' }),
      );

      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.registration).toBeNull();
    });

    it('returns the most recent registration when multiple exist', async () => {
      const older = {
        registrationId: 'reg-old',
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        status: 'FAILED',
        createdAt: '2025-01-01T00:00:00Z',
      };
      const newer = {
        registrationId: 'reg-new',
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        status: 'REGISTERED',
        createdAt: '2025-01-02T00:00:00Z',
      };
      mockSend.mockResolvedValue({ Items: [older, newer] });

      const result = await baseHandler(
        makeEvent({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1' }),
      );

      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.registration.registrationId).toBe('reg-new');
    });

    it('queries DynamoDB with correct SK prefix', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      await baseHandler(
        makeEvent({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1' }),
      );

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            TableName: 'test-table',
            ExpressionAttributeValues: expect.objectContaining({
              ':skPrefix': 'org-1#proj-1#opp-1#',
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
        baseHandler(makeEvent({ orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1' })),
      ).rejects.toThrow('DynamoDB error');
    });
  });
});
