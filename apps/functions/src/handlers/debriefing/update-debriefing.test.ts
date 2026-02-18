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
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { updateDebriefing } from './update-debriefing';
import type { UpdateDebriefingRequest } from '@auto-rfp/core';

describe('update-debriefing handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  const existingDebriefing = {
    partition_key: 'DEBRIEFING',
    sort_key: 'org-456#proj-123#debrief-1',
    id: 'debrief-1',
    projectId: 'proj-123',
    orgId: 'org-456',
    status: 'REQUESTED' as const,
    requestDate: '2025-01-15T00:00:00Z',
    requestedBy: 'user-789',
    createdAt: '2025-01-15T00:00:00Z',
    updatedAt: '2025-01-15T00:00:00Z',
  };

  describe('updateDebriefing', () => {
    it('updates status to SCHEDULED', async () => {
      const updatedItem = {
        ...existingDebriefing,
        status: 'SCHEDULED',
        scheduledDate: '2025-02-01T14:00:00Z',
        updatedAt: '2025-01-20T00:00:00Z',
      };

      mockSend.mockResolvedValue({ Attributes: updatedItem });

      const dto: UpdateDebriefingRequest = {
        debriefingId: 'debrief-1',
        projectId: 'proj-123',
        orgId: 'org-456',
        status: 'SCHEDULED',
        scheduledDate: '2025-02-01T14:00:00Z',
      };

      const result = await updateDebriefing(dto, existingDebriefing);

      expect(result.status).toBe('SCHEDULED');
      expect(result.scheduledDate).toBe('2025-02-01T14:00:00Z');
    });

    it('updates status to COMPLETED with findings', async () => {
      const updatedItem = {
        ...existingDebriefing,
        status: 'COMPLETED',
        completedDate: '2025-02-01T15:00:00Z',
        findings: 'We lost due to pricing',
        lessonsLearned: ['Be more competitive on price'],
      };

      mockSend.mockResolvedValue({ Attributes: updatedItem });

      const dto: UpdateDebriefingRequest = {
        debriefingId: 'debrief-1',
        projectId: 'proj-123',
        orgId: 'org-456',
        status: 'COMPLETED',
        completedDate: '2025-02-01T15:00:00Z',
        findings: 'We lost due to pricing',
        lessonsLearned: ['Be more competitive on price'],
      };

      const result = await updateDebriefing(dto, existingDebriefing);

      expect(result.status).toBe('COMPLETED');
      expect(result.findings).toBe('We lost due to pricing');
    });

    it('updates attendees list', async () => {
      const updatedItem = {
        ...existingDebriefing,
        attendees: ['John Smith', 'Jane Doe'],
      };

      mockSend.mockResolvedValue({ Attributes: updatedItem });

      const dto: UpdateDebriefingRequest = {
        debriefingId: 'debrief-1',
        projectId: 'proj-123',
        orgId: 'org-456',
        attendees: ['John Smith', 'Jane Doe'],
      };

      const result = await updateDebriefing(dto, existingDebriefing);

      expect(result.attendees).toEqual(['John Smith', 'Jane Doe']);
    });

    it('updates action items', async () => {
      const actionItems = [
        {
          description: 'Review pricing strategy',
          assignee: 'John Smith',
          dueDate: '2025-02-15T00:00:00Z',
          completed: false,
        },
      ];

      const updatedItem = {
        ...existingDebriefing,
        actionItems,
      };

      mockSend.mockResolvedValue({ Attributes: updatedItem });

      const dto: UpdateDebriefingRequest = {
        debriefingId: 'debrief-1',
        projectId: 'proj-123',
        orgId: 'org-456',
        actionItems,
      };

      const result = await updateDebriefing(dto, existingDebriefing);

      expect(result.actionItems).toHaveLength(1);
      expect(result.actionItems?.[0].description).toBe('Review pricing strategy');
    });

    it('sets status to DECLINED', async () => {
      const updatedItem = {
        ...existingDebriefing,
        status: 'DECLINED',
        notes: 'Agency declined to provide debriefing',
      };

      mockSend.mockResolvedValue({ Attributes: updatedItem });

      const dto: UpdateDebriefingRequest = {
        debriefingId: 'debrief-1',
        projectId: 'proj-123',
        orgId: 'org-456',
        status: 'DECLINED',
        notes: 'Agency declined to provide debriefing',
      };

      const result = await updateDebriefing(dto, existingDebriefing);

      expect(result.status).toBe('DECLINED');
    });

    it('uses correct table name and keys', async () => {
      mockSend.mockResolvedValue({ Attributes: existingDebriefing });

      const dto: UpdateDebriefingRequest = {
        debriefingId: 'debrief-1',
        projectId: 'proj-123',
        orgId: 'org-456',
        notes: 'Updated notes',
      };

      await updateDebriefing(dto, existingDebriefing);

      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            TableName: 'test-table',
            Key: {
              partition_key: 'DEBRIEFING',
              sort_key: 'org-456#proj-123#debrief-1',
            },
          }),
        })
      );
    });
  });
});
