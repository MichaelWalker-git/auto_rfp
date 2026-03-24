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

import { getDebriefingsForProject, baseHandler } from './get-debriefing';
import type { APIGatewayProxyEventV2, APIGatewayProxyResult } from 'aws-lambda';

describe('get-debriefing handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('getDebriefingsForProject', () => {
    it('queries with correct key structure', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      await getDebriefingsForProject('org-456', 'proj-123', 'opp-789');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            KeyConditionExpression: expect.stringContaining('begins_with'),
            ExpressionAttributeValues: expect.objectContaining({
              ':pk': 'DEBRIEFING',
              ':skPrefix': 'org-456#proj-123#opp-789#',
            }),
          }),
        })
      );
    });

    it('returns empty array when no debriefings found', async () => {
      mockSend.mockResolvedValue({ Items: undefined });

      const result = await getDebriefingsForProject('org-456', 'proj-123', 'opp-789');

      expect(result).toEqual([]);
    });

    it('returns debriefings when found', async () => {
      const mockItems = [
        {
          partition_key: 'DEBRIEFING',
          sort_key: 'org-456#proj-123#opp-789#debrief-1',
          debriefId: 'debrief-1',
          projectId: 'proj-123',
          orgId: 'org-456',
          opportunityId: 'opp-789',
          solicitationNumber: 'W911NF-21-R-0001',
          createdBy: 'user-789',
          createdAt: '2025-01-15T00:00:00Z',
          updatedAt: '2025-01-15T00:00:00Z',
        },
        {
          partition_key: 'DEBRIEFING',
          sort_key: 'org-456#proj-123#opp-789#debrief-2',
          debriefId: 'debrief-2',
          projectId: 'proj-123',
          orgId: 'org-456',
          opportunityId: 'opp-789',
          solicitationNumber: 'GS-00F-0001',
          createdBy: 'user-789',
          createdAt: '2025-01-10T00:00:00Z',
          updatedAt: '2025-01-10T00:00:00Z',
        },
      ];

      mockSend.mockResolvedValue({ Items: mockItems });

      const result = await getDebriefingsForProject('org-456', 'proj-123', 'opp-789');

      expect(result).toHaveLength(2);
      expect(result[0].debriefId).toBe('debrief-1');
      expect(result[1].debriefId).toBe('debrief-2');
    });

    it('uses correct table name from environment', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      await getDebriefingsForProject('org-456', 'proj-123', 'opp-789');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            TableName: 'test-table',
          }),
        })
      );
    });

    it('handles database errors', async () => {
      mockSend.mockRejectedValue(new Error('Database connection failed'));

      await expect(getDebriefingsForProject('org-456', 'proj-123', 'opp-789')).rejects.toThrow(
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

    it('returns 200 with debriefings on success', async () => {
      mockSend.mockResolvedValue({ Items: [{ debriefId: 'debrief-1', companyName: 'Acme' }] });

      const result = await baseHandler(makeEvent({
        orgId: 'org-456',
        projectId: 'proj-123',
        opportunityId: 'opp-789',
      })) as APIGatewayProxyResult;
      const parsed = JSON.parse(result.body);

      expect(result.statusCode).toBe(200);
      expect(parsed.debriefings).toHaveLength(1);
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
