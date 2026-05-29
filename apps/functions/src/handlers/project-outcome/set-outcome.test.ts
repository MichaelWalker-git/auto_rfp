// Mock middy before importing handlers (ESM compatibility)
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

// Mock uuid before importing handlers
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

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
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { setProjectOutcome } from './set-outcome';
import type { SetProjectOutcomeRequest } from '@auto-rfp/core';

describe('set-outcome handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    // Default: project exists
    mockSend.mockImplementation((cmd: { type: string }) => {
      if (cmd.type === 'Get') {
        return Promise.resolve({ Item: { id: 'proj-123' } });
      }
      return Promise.resolve({});
    });
  });

  describe('setProjectOutcome', () => {
    it('creates WON outcome with correct structure', async () => {
      mockSend.mockResolvedValue({});

      const dto: SetProjectOutcomeRequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        opportunityId: 'opp-789',
        status: 'WON',
        winData: {
          contractValue: 1500000,
          awardDate: '2025-01-15T00:00:00Z',
        },
      };

      const result = await setProjectOutcome(dto, 'user-789');

      expect(result.partition_key).toBe('PROJECT_OUTCOME');
      expect(result.sort_key).toBe('org-456#proj-123#opp-789');
      expect(result.status).toBe('WON');
      expect(result.statusSetBy).toBe('user-789');
      expect(result.statusSource).toBe('MANUAL');
      expect(result.winData).toEqual(dto.winData);
    });

    it('creates LOST outcome with loss data', async () => {
      mockSend.mockResolvedValue({});

      const dto: SetProjectOutcomeRequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        opportunityId: 'opp-789',
        status: 'LOST',
        lossData: {
          lossDate: '2025-01-20T00:00:00Z',
          lossReason: 'PRICE_TOO_HIGH',
          lossReasonDetails: 'Our bid was 15% higher',
          winningContractor: 'Acme Corp',
          winningBidAmount: 1200000,
          ourBidAmount: 1380000,
        },
      };

      const result = await setProjectOutcome(dto, 'user-789');

      expect(result.status).toBe('LOST');
      expect(result.lossData).toBeDefined();
      expect(result.lossData?.lossReason).toBe('PRICE_TOO_HIGH');
      expect(result.lossData?.winningContractor).toBe('Acme Corp');
    });

    it('creates PENDING outcome without additional data', async () => {
      mockSend.mockResolvedValue({});

      const dto: SetProjectOutcomeRequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        opportunityId: 'opp-789',
        status: 'PENDING',
      };

      const result = await setProjectOutcome(dto, 'user-789');

      expect(result.status).toBe('PENDING');
      expect(result.winData).toBeUndefined();
      expect(result.lossData).toBeUndefined();
    });

    it('creates NO_BID outcome', async () => {
      mockSend.mockResolvedValue({});

      const dto: SetProjectOutcomeRequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        opportunityId: 'opp-789',
        status: 'NO_BID',
      };

      const result = await setProjectOutcome(dto, 'user-789');

      expect(result.status).toBe('NO_BID');
    });

    it('creates WITHDRAWN outcome', async () => {
      mockSend.mockResolvedValue({});

      const dto: SetProjectOutcomeRequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        opportunityId: 'opp-789',
        status: 'WITHDRAWN',
      };

      const result = await setProjectOutcome(dto, 'user-789');

      expect(result.status).toBe('WITHDRAWN');
    });

    it('sets timestamps correctly', async () => {
      mockSend.mockResolvedValue({});
      const beforeCall = new Date().toISOString();

      const dto: SetProjectOutcomeRequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        opportunityId: 'opp-789',
        status: 'PENDING',
      };

      const result = await setProjectOutcome(dto, 'user-789');

      const afterCall = new Date().toISOString();

      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(result.statusDate).toBeDefined();

      // Timestamps should be within the test execution window
      expect(result.createdAt >= beforeCall).toBe(true);
      expect(result.createdAt <= afterCall).toBe(true);
    });

    it('handles WON with full win data including period of performance', async () => {
      mockSend.mockResolvedValue({});

      const dto: SetProjectOutcomeRequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        opportunityId: 'opp-789',
        status: 'WON',
        winData: {
          contractNumber: 'GS-35F-0001',
          contractValue: 2000000,
          awardDate: '2025-01-15T00:00:00Z',
          periodOfPerformance: {
            startDate: '2025-02-01T00:00:00Z',
            endDate: '2026-02-01T00:00:00Z',
            optionYears: 3,
          },
          competitorsBeaten: ['Competitor A', 'Competitor B'],
          keyFactors: 'Strong past performance and competitive pricing',
        },
      };

      const result = await setProjectOutcome(dto, 'user-789');

      expect(result.winData?.contractNumber).toBe('GS-35F-0001');
      expect(result.winData?.periodOfPerformance?.optionYears).toBe(3);
      expect(result.winData?.competitorsBeaten).toHaveLength(2);
    });

    it('handles LOST with evaluation scores', async () => {
      mockSend.mockResolvedValue({});

      const dto: SetProjectOutcomeRequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        opportunityId: 'opp-789',
        status: 'LOST',
        lossData: {
          lossDate: '2025-01-20T00:00:00Z',
          lossReason: 'TECHNICAL_SCORE',
          evaluationScores: {
            technical: 75,
            price: 90,
            pastPerformance: 85,
            overall: 80,
          },
        },
      };

      const result = await setProjectOutcome(dto, 'user-789');

      expect(result.lossData?.evaluationScores?.technical).toBe(75);
      expect(result.lossData?.evaluationScores?.overall).toBe(80);
    });

    it('calls DynamoDB PutCommand with correct table name', async () => {
      mockSend.mockResolvedValue({});

      const dto: SetProjectOutcomeRequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        opportunityId: 'opp-789',
        status: 'PENDING',
      };

      await setProjectOutcome(dto, 'user-789');

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            TableName: 'test-table',
          }),
        })
      );
    });
  });
});
