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
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
}));

// Mock Secrets Manager
const mockSecretsSend = jest.fn();
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSecretsSend })),
  GetSecretValueCommand: jest.fn((params) => ({ type: 'GetSecret', params })),
  PutSecretValueCommand: jest.fn((params) => ({ type: 'PutSecret', params })),
  CreateSecretCommand: jest.fn((params) => ({ type: 'CreateSecret', params })),
  ResourceNotFoundException: class ResourceNotFoundException extends Error {
    name = 'ResourceNotFoundException';
  },
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

import { baseHandler } from './save-apn-credentials';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import { setAuditContext } from '@/middleware/audit-middleware';

const makeEvent = (body: Record<string, unknown> = {}, orgId = 'org-1'): AuthedEvent =>
  ({
    body: JSON.stringify(body),
    headers: { 'user-agent': 'test-agent', 'x-org-id': orgId },
    queryStringParameters: { orgId },
    requestContext: { http: { sourceIp: '127.0.0.1' } },
    auth: { userId: 'user-123', claims: { 'cognito:username': 'testuser' }, orgId },
  } as unknown as AuthedEvent);

const validBody = {
  partnerId: 'PARTNER001',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
};

describe('save-apn-credentials handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockSecretsSend.mockReset();
  });

  describe('validation', () => {
    it('returns 400 when orgId is missing', async () => {
      const event = makeEvent(validBody);
      (event as unknown as { queryStringParameters: Record<string, string> }).queryStringParameters = {};
      (event as unknown as { headers: Record<string, string> }).headers = { 'user-agent': 'test' };
      (event as unknown as { auth: Record<string, unknown> }).auth = { userId: 'user-123', claims: {} };

      const result = await baseHandler(event);
      expect(result).toMatchObject({ statusCode: 400 });
    });

    it('returns 400 when partnerId is missing', async () => {
      const { partnerId: _, ...bodyWithoutPartnerId } = validBody;
      const result = await baseHandler(makeEvent(bodyWithoutPartnerId));
      expect(result).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.issues).toBeDefined();
    });

    it('returns 400 when accessKeyId is too short', async () => {
      const result = await baseHandler(makeEvent({ ...validBody, accessKeyId: 'SHORT' }));
      expect(result).toMatchObject({ statusCode: 400 });
    });

    it('returns 400 when secretAccessKey is missing', async () => {
      const { secretAccessKey: _, ...bodyWithoutSecret } = validBody;
      const result = await baseHandler(makeEvent(bodyWithoutSecret));
      expect(result).toMatchObject({ statusCode: 400 });
    });
  });

  describe('happy path', () => {
    it('saves credentials and returns success', async () => {
      // Mock Secrets Manager store
      mockSecretsSend.mockResolvedValueOnce({});
      // Mock DynamoDB put for metadata
      mockSend.mockResolvedValueOnce({});

      const result = await baseHandler(makeEvent(validBody));
      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.ok).toBe(true);
      expect(body.message).toContain('saved successfully');
    });

    it('applies default region of us-east-1', async () => {
      mockSecretsSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});

      await baseHandler(makeEvent(validBody));

      // Verify DynamoDB was called with region us-east-1
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            Item: expect.objectContaining({
              region: 'us-east-1',
            }),
          }),
        }),
      );
    });

    it('accepts custom region', async () => {
      mockSecretsSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});

      await baseHandler(makeEvent({ ...validBody, region: 'eu-west-1' }));

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            Item: expect.objectContaining({
              region: 'eu-west-1',
            }),
          }),
        }),
      );
    });

    it('sets audit context with CONFIG_CHANGED action', async () => {
      mockSecretsSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});

      await baseHandler(makeEvent(validBody));

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
    it('propagates Secrets Manager errors', async () => {
      mockSecretsSend.mockRejectedValue(new Error('Secrets Manager error'));

      await expect(
        baseHandler(makeEvent(validBody)),
      ).rejects.toThrow('Secrets Manager error');
    });

    it('propagates DynamoDB errors', async () => {
      mockSecretsSend.mockResolvedValueOnce({});
      mockSend.mockRejectedValue(new Error('DynamoDB error'));

      await expect(
        baseHandler(makeEvent(validBody)),
      ).rejects.toThrow('DynamoDB error');
    });
  });
});
