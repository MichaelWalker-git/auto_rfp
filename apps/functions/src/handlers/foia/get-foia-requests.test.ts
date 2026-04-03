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
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
}));

// Mock sentry
jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: jest.fn((handler: unknown) => handler),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { getFOIARequestsForProject, baseHandler } from './get-foia-requests';
import type { APIGatewayProxyEventV2, APIGatewayProxyResult } from 'aws-lambda';

describe('get-foia-requests handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('getFOIARequestsForProject', () => {
    it('queries with correct key structure', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      await getFOIARequestsForProject('org-456', 'proj-123', 'opp-789');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            KeyConditionExpression: expect.stringContaining('begins_with'),
            ExpressionAttributeValues: expect.objectContaining({
              ':pk': 'FOIA_REQUEST',
              ':skPrefix': 'org-456#proj-123#opp-789#',
            }),
          }),
        })
      );
    });

    it('returns empty array when no requests found', async () => {
      mockSend.mockResolvedValue({ Items: undefined });

      const result = await getFOIARequestsForProject('org-456', 'proj-123', 'opp-789');

      expect(result).toEqual([]);
    });

    it('returns FOIA requests when found', async () => {
      const mockItems = [
        {
          partition_key: 'FOIA_REQUEST',
          sort_key: 'org-456#proj-123#opp-789#foia-1',
          foiaId: 'foia-1',
          id: 'foia-1',
          projectId: 'proj-123',
          orgId: 'org-456',
          opportunityId: 'opp-789',
          agencyName: 'DOD',
          agencyFOIAEmail: 'foia@dod.gov',
          agencyFOIAAddress: '1400 Defense Pentagon, Washington DC 20301',
          solicitationNumber: 'W911NF-21-R-0001',
          contractTitle: 'IT Services',
          requestedDocuments: ['SSEB_REPORT'],
          companyName: 'Acme Corp',
          awardDate: 'January 15, 2026',
          requesterName: 'John Smith',
          requesterTitle: 'Contracts Manager',
          requesterEmail: 'john@company.com',
          requesterPhone: '555-123-4567',
          requesterAddress: '123 Business Ave',
          requestedBy: 'user-789',
          createdAt: '2025-01-15T00:00:00Z',
          updatedAt: '2025-01-15T00:00:00Z',
          createdBy: 'user-789',
        },
        {
          partition_key: 'FOIA_REQUEST',
          sort_key: 'org-456#proj-123#opp-789#foia-2',
          foiaId: 'foia-2',
          id: 'foia-2',
          projectId: 'proj-123',
          orgId: 'org-456',
          opportunityId: 'opp-789',
          agencyName: 'DOD',
          agencyFOIAEmail: 'foia@dod.gov',
          agencyFOIAAddress: '1400 Defense Pentagon, Washington DC 20301',
          solicitationNumber: 'GS-00F-0001',
          contractTitle: 'Cloud Services',
          requestedDocuments: ['TECHNICAL_EVAL'],
          companyName: 'Acme Corp',
          awardDate: 'February 1, 2026',
          requesterName: 'John Smith',
          requesterTitle: 'Contracts Manager',
          requesterEmail: 'john@company.com',
          requesterPhone: '555-123-4567',
          requesterAddress: '123 Business Ave',
          requestedBy: 'user-789',
          createdAt: '2025-01-10T00:00:00Z',
          updatedAt: '2025-01-10T00:00:00Z',
          createdBy: 'user-789',
        },
      ];

      mockSend.mockResolvedValue({ Items: mockItems });

      const result = await getFOIARequestsForProject('org-456', 'proj-123', 'opp-789');

      expect(result).toHaveLength(2);
      expect(result[0].foiaId).toBe('foia-1');
      expect(result[1].foiaId).toBe('foia-2');
    });

    it('handles database errors', async () => {
      mockSend.mockRejectedValue(new Error('Database connection failed'));

      await expect(getFOIARequestsForProject('org-456', 'proj-123', 'opp-789')).rejects.toThrow(
        'Database connection failed'
      );
    });
  });

  describe('baseHandler', () => {
    const makeEvent = (queryParams: Record<string, string | undefined>): APIGatewayProxyEventV2 =>
      ({
        queryStringParameters: queryParams,
      }) as unknown as APIGatewayProxyEventV2;

    it('returns 400 when orgId is missing', async () => {
      const result = await baseHandler(makeEvent({ projectId: 'proj-123', opportunityId: 'opp-789' })) as APIGatewayProxyResult;
      const parsed = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toContain('Missing required query parameters');
    });

    it('returns 400 when projectId is missing', async () => {
      const result = await baseHandler(makeEvent({ orgId: 'org-456', opportunityId: 'opp-789' })) as APIGatewayProxyResult;
      const parsed = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toContain('Missing required query parameters');
    });

    it('returns 400 when opportunityId is missing', async () => {
      const result = await baseHandler(makeEvent({ orgId: 'org-456', projectId: 'proj-123' })) as APIGatewayProxyResult;
      const parsed = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toContain('Missing required query parameters');
    });

    it('returns 400 when queryStringParameters is undefined', async () => {
      const event = {} as unknown as APIGatewayProxyEventV2;
      const result = await baseHandler(event) as APIGatewayProxyResult;
      const parsed = JSON.parse(result.body);

      expect(result.statusCode).toBe(400);
      expect(parsed.message).toContain('Missing required query parameters');
    });

    it('returns 200 with FOIA requests on success', async () => {
      mockSend.mockResolvedValue({ Items: [{ foiaId: 'foia-1', agencyName: 'DOD' }] });

      const result = await baseHandler(makeEvent({
        orgId: 'org-456',
        projectId: 'proj-123',
        opportunityId: 'opp-789',
      })) as APIGatewayProxyResult;
      const parsed = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(parsed.foiaRequests).toHaveLength(1);
    });

    it('returns 500 when database throws', async () => {
      mockSend.mockRejectedValue(new Error('DB failure'));

      const result = await baseHandler(makeEvent({
        orgId: 'org-456',
        projectId: 'proj-123',
        opportunityId: 'opp-789',
      })) as APIGatewayProxyResult;
      const parsed = JSON.parse(result.body);

      expect(result.statusCode).toBe(500);
      expect(parsed.message).toBe('Internal server error');
    });
  });
});
