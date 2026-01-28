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
        contactEmail: 'co@example.com',
        contactName: 'John Doe',
      };

      const result = await createDebriefing(dto, 'user-789');

      expect(result.partition_key).toBe('DEBRIEFING');
      expect(result.sort_key).toBe('org-456#proj-123#mock-uuid');
      expect(result.status).toBe('REQUESTED');
      expect(result.requestedBy).toBe('user-789');
      expect(result.contactEmail).toBe('co@example.com');
      expect(result.contactName).toBe('John Doe');
    });

    it('calculates request deadline', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateDebriefingRequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        contactEmail: 'co@example.com',
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
        contactEmail: 'co@example.com',
        contactName: 'Jane Smith',
        contactPhone: '555-1234',
        notes: 'Please schedule ASAP',
      };

      const result = await createDebriefing(dto, 'user-789');

      expect(result.contactPhone).toBe('555-1234');
      expect(result.notes).toBe('Please schedule ASAP');
    });

    it('sets timestamps correctly', async () => {
      mockSend.mockResolvedValue({});
      const beforeCall = new Date().toISOString();

      const dto: CreateDebriefingRequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        contactEmail: 'co@example.com',
      };

      const result = await createDebriefing(dto, 'user-789');

      const afterCall = new Date().toISOString();

      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
      expect(result.requestDate).toBeDefined();
      expect(result.createdAt >= beforeCall).toBe(true);
      expect(result.createdAt <= afterCall).toBe(true);
    });

    it('calls DynamoDB with correct table name', async () => {
      mockSend.mockResolvedValue({});

      const dto: CreateDebriefingRequest = {
        projectId: 'proj-123',
        orgId: 'org-456',
        contactEmail: 'co@example.com',
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
