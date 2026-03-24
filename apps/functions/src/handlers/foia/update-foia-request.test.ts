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
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
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

import { updateFOIARequest, baseHandler } from './update-foia-request';
import type { UpdateFOIARequest } from '@auto-rfp/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const validDto: UpdateFOIARequest = {
  orgId: 'org-456',
  projectId: 'proj-123',
  opportunityId: 'opp-789',
  foiaRequestId: 'foia-001',
  agencyName: 'Updated Agency',
  requesterName: 'Jane Updated',
};

describe('update-foia-request handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('updateFOIARequest', () => {
    it('updates FOIA request with provided fields', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { foiaId: 'foia-001', agencyName: 'Old Agency' },
      });
      mockSend.mockResolvedValueOnce({
        Attributes: {
          foiaId: 'foia-001',
          agencyName: 'Updated Agency',
          requesterName: 'Jane Updated',
          updatedAt: expect.any(String),
        },
      });

      const result = await updateFOIARequest(validDto);

      expect(result).toBeDefined();
      expect(result?.agencyName).toBe('Updated Agency');
      expect(result?.requesterName).toBe('Jane Updated');
    });

    it('throws when FOIA request not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      await expect(updateFOIARequest(validDto)).rejects.toThrow('FOIA request not found');
    });

    it('uses correct PK and SK for lookup', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { foiaId: 'foia-001' },
      });
      mockSend.mockResolvedValueOnce({ Attributes: {} });

      await updateFOIARequest(validDto);

      const getCall = mockSend.mock.calls[0][0];
      expect(getCall.type).toBe('Get');
      expect(getCall.params.Key.partition_key).toBe('FOIA_REQUEST');
      expect(getCall.params.Key.sort_key).toBe('org-456#proj-123#opp-789#foia-001');
    });

    it('builds UpdateCommand with only provided fields', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { foiaId: 'foia-001' },
      });
      mockSend.mockResolvedValueOnce({ Attributes: {} });

      const minimalDto: UpdateFOIARequest = {
        orgId: 'org-456',
        projectId: 'proj-123',
        opportunityId: 'opp-789',
        foiaRequestId: 'foia-001',
        feeLimit: 200,
      };

      await updateFOIARequest(minimalDto);

      const updateCall = mockSend.mock.calls[1][0];
      expect(updateCall.type).toBe('Update');
      expect(updateCall.params.UpdateExpression).toContain('#feeLimit');
      expect(updateCall.params.UpdateExpression).toContain('#updatedAt');
      expect(updateCall.params.UpdateExpression).not.toContain('#agencyName');
    });

    it('handles requestedDocuments array update', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { foiaId: 'foia-001' },
      });
      mockSend.mockResolvedValueOnce({ Attributes: {} });

      const dtoWithDocs: UpdateFOIARequest = {
        orgId: 'org-456',
        projectId: 'proj-123',
        opportunityId: 'opp-789',
        foiaRequestId: 'foia-001',
        requestedDocuments: ['SSEB_REPORT', 'TECHNICAL_EVAL', 'PRICE_ANALYSIS'],
      };

      await updateFOIARequest(dtoWithDocs);

      const updateCall = mockSend.mock.calls[1][0];
      expect(updateCall.params.ExpressionAttributeValues[':requestedDocuments']).toEqual([
        'SSEB_REPORT',
        'TECHNICAL_EVAL',
        'PRICE_ANALYSIS',
      ]);
    });

    it('always sets updatedAt', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { foiaId: 'foia-001' },
      });
      mockSend.mockResolvedValueOnce({ Attributes: {} });

      const identifiersOnly: UpdateFOIARequest = {
        orgId: 'org-456',
        projectId: 'proj-123',
        opportunityId: 'opp-789',
        foiaRequestId: 'foia-001',
      };

      await updateFOIARequest(identifiersOnly);

      const updateCall = mockSend.mock.calls[1][0];
      expect(updateCall.params.UpdateExpression).toContain('#updatedAt = :updatedAt');
    });

    it('uses correct table name', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { foiaId: 'foia-001' },
      });
      mockSend.mockResolvedValueOnce({ Attributes: {} });

      await updateFOIARequest(validDto);

      const updateCall = mockSend.mock.calls[1][0];
      expect(updateCall.params.TableName).toBe('test-table');
    });
  });

  describe('baseHandler', () => {
    const makeEvent = (body: Record<string, unknown>): APIGatewayProxyEventV2 =>
      ({
        body: JSON.stringify(body),
      }) as unknown as APIGatewayProxyEventV2;

    it('returns 200 on successful update', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { foiaId: 'foia-001' },
      });
      mockSend.mockResolvedValueOnce({
        Attributes: { foiaId: 'foia-001', agencyName: 'Updated Agency' },
      });

      const result = await baseHandler(makeEvent(validDto));

      expect(result.statusCode).toBe(200);
      const parsed = JSON.parse(result.body as string);
      expect(parsed.foiaRequest).toBeDefined();
    });

    it('returns 400 for validation errors', async () => {
      const result = await baseHandler(makeEvent({
        orgId: '',
        projectId: 'proj-123',
      }));
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

    it('returns 400 when body is missing', async () => {
      const event = { body: undefined } as unknown as APIGatewayProxyEventV2;
      const result = await baseHandler(event);
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toBe('Request body is missing');
    });

    it('returns 400 for invalid JSON', async () => {
      const event = { body: 'not-json{' } as unknown as APIGatewayProxyEventV2;
      const result = await baseHandler(event);
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toBe('Invalid JSON in request body');
    });
  });
});
