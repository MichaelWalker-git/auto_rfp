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
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { getProjectOutcome } from './get-outcome';

describe('get-outcome handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('getProjectOutcome', () => {
    it('queries with correct key structure', async () => {
      mockSend.mockResolvedValue({ Item: null });

      await getProjectOutcome('org-456', 'proj-123');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            Key: {
              partition_key: 'PROJECT_OUTCOME',
              sort_key: 'org-456#proj-123',
            },
          }),
        })
      );
    });

    it('returns null when item not found', async () => {
      mockSend.mockResolvedValue({ Item: undefined });

      const result = await getProjectOutcome('org-456', 'proj-123');

      expect(result).toBeNull();
    });

    it('returns null when Item is null', async () => {
      mockSend.mockResolvedValue({ Item: null });

      const result = await getProjectOutcome('org-456', 'proj-123');

      expect(result).toBeNull();
    });

    it('returns WON outcome when found', async () => {
      const mockItem = {
        partition_key: 'PROJECT_OUTCOME',
        sort_key: 'org-456#proj-123',
        projectId: 'proj-123',
        orgId: 'org-456',
        status: 'WON',
        statusDate: '2025-01-15T00:00:00Z',
        statusSetBy: 'user-789',
        statusSource: 'MANUAL',
        winData: {
          contractValue: 1500000,
          awardDate: '2025-01-15T00:00:00Z',
          contractNumber: 'GS-35F-0001',
        },
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
      };

      mockSend.mockResolvedValue({ Item: mockItem });

      const result = await getProjectOutcome('org-456', 'proj-123');

      expect(result).toEqual(mockItem);
      expect(result?.status).toBe('WON');
      expect(result?.winData?.contractValue).toBe(1500000);
    });

    it('returns LOST outcome when found', async () => {
      const mockItem = {
        partition_key: 'PROJECT_OUTCOME',
        sort_key: 'org-456#proj-123',
        projectId: 'proj-123',
        orgId: 'org-456',
        status: 'LOST',
        statusDate: '2025-01-20T00:00:00Z',
        statusSetBy: 'user-789',
        statusSource: 'MANUAL',
        lossData: {
          lossDate: '2025-01-20T00:00:00Z',
          lossReason: 'INCUMBENT_ADVANTAGE',
          winningContractor: 'Acme Corp',
        },
        createdAt: '2025-01-20T00:00:00Z',
        updatedAt: '2025-01-20T00:00:00Z',
      };

      mockSend.mockResolvedValue({ Item: mockItem });

      const result = await getProjectOutcome('org-456', 'proj-123');

      expect(result?.status).toBe('LOST');
      expect(result?.lossData?.lossReason).toBe('INCUMBENT_ADVANTAGE');
    });

    it('returns PENDING outcome when found', async () => {
      const mockItem = {
        partition_key: 'PROJECT_OUTCOME',
        sort_key: 'org-456#proj-123',
        projectId: 'proj-123',
        orgId: 'org-456',
        status: 'PENDING',
        statusDate: '2025-01-10T00:00:00Z',
        statusSetBy: 'user-789',
        statusSource: 'MANUAL',
        createdAt: '2025-01-10T00:00:00Z',
        updatedAt: '2025-01-10T00:00:00Z',
      };

      mockSend.mockResolvedValue({ Item: mockItem });

      const result = await getProjectOutcome('org-456', 'proj-123');

      expect(result?.status).toBe('PENDING');
      expect(result?.winData).toBeUndefined();
      expect(result?.lossData).toBeUndefined();
    });

    it('returns SAM_GOV_SYNC outcome', async () => {
      const mockItem = {
        partition_key: 'PROJECT_OUTCOME',
        sort_key: 'org-456#proj-123',
        projectId: 'proj-123',
        orgId: 'org-456',
        status: 'WON',
        statusDate: '2025-01-15T00:00:00Z',
        statusSetBy: 'system',
        statusSource: 'SAM_GOV_SYNC',
        winData: {
          contractValue: 500000,
          awardDate: '2025-01-15T00:00:00Z',
        },
        createdAt: '2025-01-15T00:00:00Z',
        updatedAt: '2025-01-15T00:00:00Z',
      };

      mockSend.mockResolvedValue({ Item: mockItem });

      const result = await getProjectOutcome('org-456', 'proj-123');

      expect(result?.statusSource).toBe('SAM_GOV_SYNC');
    });

    it('uses correct table name from environment', async () => {
      mockSend.mockResolvedValue({ Item: null });

      await getProjectOutcome('org-456', 'proj-123');

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

      await expect(getProjectOutcome('org-456', 'proj-123')).rejects.toThrow(
        'Database connection failed'
      );
    });
  });
});
