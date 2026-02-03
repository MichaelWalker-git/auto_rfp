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

import { getFOIARequestsForProject } from './get-foia-requests';

describe('get-foia-requests handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('getFOIARequestsForProject', () => {
    it('queries with correct key structure', async () => {
      mockSend.mockResolvedValue({ Items: [] });

      await getFOIARequestsForProject('org-456', 'proj-123');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            KeyConditionExpression: expect.stringContaining('begins_with'),
            ExpressionAttributeValues: expect.objectContaining({
              ':pk': 'FOIA_REQUEST',
              ':skPrefix': 'org-456#proj-123#',
            }),
          }),
        })
      );
    });

    it('returns empty array when no requests found', async () => {
      mockSend.mockResolvedValue({ Items: undefined });

      const result = await getFOIARequestsForProject('org-456', 'proj-123');

      expect(result).toEqual([]);
    });

    it('returns FOIA requests when found', async () => {
      const mockItems = [
        {
          partition_key: 'FOIA_REQUEST',
          sort_key: 'org-456#proj-123#foia-1',
          id: 'foia-1',
          projectId: 'proj-123',
          orgId: 'org-456',
          status: 'DRAFT',
          agencyName: 'DOD',
          requestedDocuments: ['SSEB_REPORT'],
        },
        {
          partition_key: 'FOIA_REQUEST',
          sort_key: 'org-456#proj-123#foia-2',
          id: 'foia-2',
          projectId: 'proj-123',
          orgId: 'org-456',
          status: 'SUBMITTED',
          agencyName: 'DOD',
          requestedDocuments: ['TECHNICAL_EVAL'],
        },
      ];

      mockSend.mockResolvedValue({ Items: mockItems });

      const result = await getFOIARequestsForProject('org-456', 'proj-123');

      expect(result).toHaveLength(2);
      expect(result[0].status).toBe('DRAFT');
      expect(result[1].status).toBe('SUBMITTED');
    });

    it('handles database errors', async () => {
      mockSend.mockRejectedValue(new Error('Database connection failed'));

      await expect(getFOIARequestsForProject('org-456', 'proj-123')).rejects.toThrow(
        'Database connection failed'
      );
    });
  });
});
