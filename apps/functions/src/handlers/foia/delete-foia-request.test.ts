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
    from: jest.fn(() => ({
      send: mockSend,
    })),
  },
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  DeleteCommand: jest.fn((params) => ({ type: 'Delete', params })),
}));

// Mock audit middleware
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ before: jest.fn(), after: jest.fn() })),
  setAuditContext: jest.fn(),
}));

// Mock sentry
jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: jest.fn((handler: unknown) => handler),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { deleteFOIARequest, baseHandler } from './delete-foia-request';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const validDto = {
  orgId: 'org-456',
  projectId: 'proj-123',
  opportunityId: 'opp-789',
  foiaRequestId: 'foia-001',
};

describe('delete-foia-request handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('deleteFOIARequest', () => {
    it('deletes the FOIA request when it exists', async () => {
      mockSend.mockResolvedValueOnce({ Item: { foiaId: 'foia-001' } });
      mockSend.mockResolvedValueOnce({});

      await deleteFOIARequest(validDto);

      const getCall = mockSend.mock.calls[0][0];
      const deleteCall = mockSend.mock.calls[1][0];
      expect(getCall.type).toBe('Get');
      expect(deleteCall.type).toBe('Delete');
    });

    it('throws when the FOIA request is not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      await expect(deleteFOIARequest(validDto)).rejects.toThrow('FOIA request not found');
    });

    it('uses correct PK and SK for lookup and delete', async () => {
      mockSend.mockResolvedValueOnce({ Item: { foiaId: 'foia-001' } });
      mockSend.mockResolvedValueOnce({});

      await deleteFOIARequest(validDto);

      const getCall = mockSend.mock.calls[0][0];
      const deleteCall = mockSend.mock.calls[1][0];
      expect(getCall.params.Key.partition_key).toBe('FOIA_REQUEST');
      expect(getCall.params.Key.sort_key).toBe('org-456#proj-123#opp-789#foia-001');
      expect(deleteCall.params.Key.sort_key).toBe('org-456#proj-123#opp-789#foia-001');
      expect(deleteCall.params.TableName).toBe('test-table');
    });

    it('does not call delete when the item is missing', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      await expect(deleteFOIARequest(validDto)).rejects.toThrow();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });
  });

  describe('baseHandler', () => {
    const makeEvent = (query: Record<string, string>): APIGatewayProxyEventV2 =>
      ({
        queryStringParameters: query,
      }) as unknown as APIGatewayProxyEventV2;

    it('returns 200 on successful delete', async () => {
      mockSend.mockResolvedValueOnce({ Item: { foiaId: 'foia-001' } });
      mockSend.mockResolvedValueOnce({});

      const result = await baseHandler(makeEvent(validDto));

      expect(result.statusCode).toBe(200);
      const parsed = JSON.parse(result.body as string);
      expect(parsed.foiaRequestId).toBe('foia-001');
    });

    it('returns 400 for missing query parameters', async () => {
      const result = await baseHandler(makeEvent({ orgId: 'org-456' }));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toBe('Validation failed');
    });

    it('returns 404 when FOIA request not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await baseHandler(makeEvent(validDto));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(404);
      expect(parsed.message).toBe('FOIA request not found');
    });

    it('returns 500 on unexpected error', async () => {
      mockSend.mockRejectedValueOnce(new Error('DynamoDB down'));

      const result = await baseHandler(makeEvent(validDto));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(500);
      expect(parsed.message).toBe('Internal server error');
    });
  });
});
