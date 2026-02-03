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

import { createDebriefing } from './create-debriefing';
import type { CreateDebriefingRequest } from '@auto-rfp/shared';

describe('create-debriefing handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('createDebriefing', () => {
    it('creates debriefing with correct structure', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateDebriefingRequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
      };

      const result = await createDebriefing(dto, 'user-789');

      expect(result.partition_key).toBe('DEBRIEFING');
      expect(result.sort_key).toBe('org-456#proj-123#mock-uuid');
      expect(result.debriefId).toBe('mock-uuid');
      expect(result.requestStatus).toBe('REQUESTED');
      expect(result.createdBy).toBe('user-789');
    });

    it('calculates request deadline', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateDebriefingRequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
      };

      const result = await createDebriefing(dto, 'user-789');

      expect(result.requestDeadline).toBeDefined();
      // Deadline should be in the future
      expect(new Date(result.requestDeadline) > new Date()).toBe(true);
    });

    it('includes optional fields when provided', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateDebriefingRequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        requestDeadline: '2025-02-15T00:00:00Z',
      };

      const result = await createDebriefing(dto, 'user-789');

      expect(result.requestDeadline).toBeDefined();
      // Check that the deadline is set and is a valid ISO string
      expect(new Date(result.requestDeadline as string).getTime()).toBeGreaterThan(0);
    });

    it('sets timestamps correctly', async () => {
      mockSend.mockResolvedValue({});
      const beforeCall = new Date().toISOString();

      const dto: CreateDebriefingRequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
      };

      const result = await createDebriefing(dto, 'user-789');

      const afterCall = new Date().toISOString();

      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(result.createdAt >= beforeCall).toBe(true);
      expect(result.createdAt <= afterCall).toBe(true);
    });

    it('calls DynamoDB with correct table name', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateDebriefingRequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
      };

      await createDebriefing(dto, 'user-789');

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
