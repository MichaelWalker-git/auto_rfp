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

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { getDebriefingsForProject } from './get-debriefing';

describe('get-debriefing handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('getDebriefingsForProject', () => {
    it('queries with correct key structure', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      await getDebriefingsForProject('org-456', 'proj-123');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            KeyConditionExpression: expect.stringContaining('begins_with'),
            ExpressionAttributeValues: expect.objectContaining({
              ':pk': 'DEBRIEFING',
              ':skPrefix': 'org-456#proj-123#',
            }),
          }),
        })
      );
    });

    it('returns empty array when no debriefings found', async () => {
      mockSend.mockResolvedValue({ Items: undefined });

      const result = await getDebriefingsForProject('org-456', 'proj-123');

      expect(result).toEqual([]);
    });

    it('returns debriefings when found', async () => {
      const mockItems = [
        {
          partition_key: 'DEBRIEFING',
          sort_key: 'org-456#proj-123#debrief-1',
          debriefId: 'debrief-1',
          projectId: 'proj-123',
          orgId: 'org-456',
          requestStatus: 'REQUESTED',
          requestDeadline: '2025-01-15T00:00:00Z',
          createdBy: 'user-789',
          createdAt: '2025-01-15T00:00:00Z',
          updatedAt: '2025-01-15T00:00:00Z',
        },
        {
          partition_key: 'DEBRIEFING',
          sort_key: 'org-456#proj-123#debrief-2',
          debriefId: 'debrief-2',
          projectId: 'proj-123',
          orgId: 'org-456',
          requestStatus: 'COMPLETED',
          requestDeadline: '2025-01-10T00:00:00Z',
          createdBy: 'user-789',
          createdAt: '2025-01-10T00:00:00Z',
          updatedAt: '2025-01-10T00:00:00Z',
        },
      ];

      mockSend.mockResolvedValue({ Items: mockItems });

      const result = await getDebriefingsForProject('org-456', 'proj-123');

      expect(result).toHaveLength(2);
      expect(result[0].requestStatus).toBe('REQUESTED');
      expect(result[1].requestStatus).toBe('COMPLETED');
    });

    it('uses correct table name from environment', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      await getDebriefingsForProject('org-456', 'proj-123');

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

      await expect(getDebriefingsForProject('org-456', 'proj-123')).rejects.toThrow(
        'Database connection failed'
      );
    });
  });
});
