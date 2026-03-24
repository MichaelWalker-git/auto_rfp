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

import { updateDebriefing, baseHandler } from './update-debriefing';
import type { UpdateDebriefingRequest } from '@auto-rfp/core';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const validDto: UpdateDebriefingRequest = {
  orgId: 'org-456',
  projectId: 'proj-123',
  opportunityId: 'opp-789',
  debriefingId: 'debrief-001',
  contractTitle: 'Updated Title',
  requesterName: 'Jane Updated',
};

describe('update-debriefing handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('updateDebriefing', () => {
    it('updates debriefing with provided fields', async () => {
      // GetCommand — item exists
      mockSend.mockResolvedValueOnce({
        Item: { debriefId: 'debrief-001', contractTitle: 'Old Title' },
      });
      // UpdateCommand — returns updated item
      mockSend.mockResolvedValueOnce({
        Attributes: {
          debriefId: 'debrief-001',
          contractTitle: 'Updated Title',
          requesterName: 'Jane Updated',
          updatedAt: expect.any(String),
        },
      });

      const result = await updateDebriefing(validDto);

      expect(result).toBeDefined();
      expect(result?.contractTitle).toBe('Updated Title');
      expect(result?.requesterName).toBe('Jane Updated');
    });

    it('throws when debriefing not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      await expect(updateDebriefing(validDto)).rejects.toThrow('Debriefing not found');
    });

    it('uses correct PK and SK for lookup', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { debriefId: 'debrief-001' },
      });
      mockSend.mockResolvedValueOnce({ Attributes: {} });

      await updateDebriefing(validDto);

      const getCall = mockSend.mock.calls[0][0];
      expect(getCall.type).toBe('Get');
      expect(getCall.params.Key.partition_key).toBe('DEBRIEFING');
      expect(getCall.params.Key.sort_key).toBe('org-456#proj-123#opp-789#debrief-001');
    });

    it('builds UpdateCommand with only provided fields', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { debriefId: 'debrief-001' },
      });
      mockSend.mockResolvedValueOnce({ Attributes: {} });

      const minimalDto: UpdateDebriefingRequest = {
        orgId: 'org-456',
        projectId: 'proj-123',
        opportunityId: 'opp-789',
        debriefingId: 'debrief-001',
        companyName: 'New Corp',
      };

      await updateDebriefing(minimalDto);

      const updateCall = mockSend.mock.calls[1][0];
      expect(updateCall.type).toBe('Update');
      expect(updateCall.params.UpdateExpression).toContain('#companyName');
      expect(updateCall.params.UpdateExpression).toContain('#updatedAt');
      // Should NOT contain fields that weren't provided
      expect(updateCall.params.UpdateExpression).not.toContain('#contractTitle');
    });

    it('always sets updatedAt', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { debriefId: 'debrief-001' },
      });
      mockSend.mockResolvedValueOnce({ Attributes: {} });

      const identifiersOnly: UpdateDebriefingRequest = {
        orgId: 'org-456',
        projectId: 'proj-123',
        opportunityId: 'opp-789',
        debriefingId: 'debrief-001',
      };

      await updateDebriefing(identifiersOnly);

      const updateCall = mockSend.mock.calls[1][0];
      expect(updateCall.params.UpdateExpression).toContain('#updatedAt = :updatedAt');
      expect(updateCall.params.ExpressionAttributeValues[':updatedAt']).toBeDefined();
    });

    it('uses correct table name', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { debriefId: 'debrief-001' },
      });
      mockSend.mockResolvedValueOnce({ Attributes: {} });

      await updateDebriefing(validDto);

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
        Item: { debriefId: 'debrief-001' },
      });
      mockSend.mockResolvedValueOnce({
        Attributes: { debriefId: 'debrief-001', contractTitle: 'Updated Title' },
      });

      const result = await baseHandler(makeEvent(validDto));

      expect(result.statusCode).toBe(200);
      const parsed = JSON.parse(result.body as string);
      expect(parsed.debriefing).toBeDefined();
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

    it('returns 404 when debriefing not found', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await baseHandler(makeEvent(validDto));
      const parsed = JSON.parse(result.body as string);

      expect(result.statusCode).toBe(404);
      expect(parsed.message).toBe('Debriefing not found');
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
