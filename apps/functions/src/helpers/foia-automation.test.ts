const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
}));

jest.mock('@/helpers/opportunity', () => ({
  updateOpportunity: jest.fn(),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import {
  buildFoiaAutomationSk,
  transitionFoiaAutomationState,
  syncOpportunityFoiaMarker,
  countFoiaSentToday,
} from './foia-automation';
import type { FoiaAutomationDBItem } from '@auto-rfp/core';
import { updateOpportunity } from '@/helpers/opportunity';

const mockUpdateOpportunity = updateOpportunity as jest.MockedFunction<typeof updateOpportunity>;

describe('foia-automation helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('buildFoiaAutomationSk', () => {
    it('builds SK with correct format', () => {
      const sk = buildFoiaAutomationSk('org-123', 'proj-456', 'opp-789');
      expect(sk).toBe('org-123#proj-456#opp-789');
    });

    it('handles empty segments gracefully', () => {
      const sk = buildFoiaAutomationSk('', '', '');
      expect(sk).toBe('##');
    });
  });

  describe('transitionFoiaAutomationState', () => {
    it('returns updated item on successful transition', async () => {
      const updated: FoiaAutomationDBItem = {
        partition_key: 'FOIA_AUTOMATION',
        sort_key: 'org-1#proj-1#opp-1',
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        state: 'SENDING',
        createdAt: '2026-08-10T10:00:00.000Z',
        updatedAt: '2026-08-11T10:00:00.000Z',
      };

      mockSend.mockResolvedValueOnce({ Attributes: updated });

      const result = await transitionFoiaAutomationState({
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        from: 'SCHEDULED',
        to: 'SENDING',
      });

      expect(result).toEqual(updated);
      expect(mockSend).toHaveBeenCalledTimes(1);

      const call = mockSend.mock.calls[0][0];
      expect(call.type).toBe('Update');
      expect(call.params.ConditionExpression).toContain('#state IN');
      expect(call.params.ExpressionAttributeValues[':from0']).toBe('SCHEDULED');
      expect(call.params.ExpressionAttributeValues[':to']).toBe('SENDING');
    });

    it('accepts array of from states', async () => {
      const updated: FoiaAutomationDBItem = {
        partition_key: 'FOIA_AUTOMATION',
        sort_key: 'org-1#proj-1#opp-1',
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        state: 'SENT',
        createdAt: '2026-08-10T10:00:00.000Z',
        updatedAt: '2026-08-11T10:00:00.000Z',
      };

      mockSend.mockResolvedValueOnce({ Attributes: updated });

      const result = await transitionFoiaAutomationState({
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        from: ['SCHEDULED', 'AWAITING_APPROVAL', 'SENDING'],
        to: 'SENT',
      });

      expect(result).toEqual(updated);

      const call = mockSend.mock.calls[0][0];
      expect(call.params.ExpressionAttributeValues[':from0']).toBe('SCHEDULED');
      expect(call.params.ExpressionAttributeValues[':from1']).toBe('AWAITING_APPROVAL');
      expect(call.params.ExpressionAttributeValues[':from2']).toBe('SENDING');
    });

    it('returns null on ConditionalCheckFailedException', async () => {
      const error = new Error('ConditionalCheckFailed');
      (error as any).name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(error);

      const result = await transitionFoiaAutomationState({
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        from: 'SCHEDULED',
        to: 'SENDING',
      });

      expect(result).toBeNull();
    });

    it('throws on non-conditional errors after retries exhausted', async () => {
      const error = new Error('InternalError');
      (error as any).name = 'InternalServerError';
      // withRetry retries InternalServerError 3 times (default max retries)
      mockSend.mockRejectedValue(error);

      await expect(
        transitionFoiaAutomationState({
          orgId: 'org-1',
          projectId: 'proj-1',
          oppId: 'opp-1',
          from: 'SCHEDULED',
          to: 'SENDING',
        }),
      ).rejects.toThrow('InternalError');

      // Should have retried 3 times (1 initial + 3 retries = 4 total)
      expect(mockSend).toHaveBeenCalledTimes(4);
    });

    it('includes patch fields in update expression', async () => {
      const updated: FoiaAutomationDBItem = {
        partition_key: 'FOIA_AUTOMATION',
        sort_key: 'org-1#proj-1#opp-1',
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        state: 'SENT',
        sentAt: '2026-08-11T10:00:00.000Z',
        sesMessageId: 'msg-123',
        createdAt: '2026-08-10T10:00:00.000Z',
        updatedAt: '2026-08-11T10:00:00.000Z',
      };

      mockSend.mockResolvedValueOnce({ Attributes: updated });

      await transitionFoiaAutomationState({
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        from: 'SENDING',
        to: 'SENT',
        patch: {
          sentAt: '2026-08-11T10:00:00.000Z',
          sesMessageId: 'msg-123',
        },
      });

      const call = mockSend.mock.calls[0][0];
      expect(call.params.UpdateExpression).toContain('#p_sentAt = :p_sentAt');
      expect(call.params.UpdateExpression).toContain('#p_sesMessageId = :p_sesMessageId');
      expect(call.params.ExpressionAttributeValues[':p_sentAt']).toBe('2026-08-11T10:00:00.000Z');
      expect(call.params.ExpressionAttributeValues[':p_sesMessageId']).toBe('msg-123');
    });
  });

  describe('syncOpportunityFoiaMarker', () => {
    it('calls updateOpportunity with state patch', async () => {
      mockUpdateOpportunity.mockResolvedValueOnce({
        item: {} as any,
        oppId: 'opp-1',
      });

      await syncOpportunityFoiaMarker('org-1', 'proj-1', 'opp-1', 'SENT');

      expect(mockUpdateOpportunity).toHaveBeenCalledWith({
        orgId: 'org-1',
        projectId: 'proj-1',
        oppId: 'opp-1',
        patch: { foiaAutomationState: 'SENT' },
      });
    });

    it('logs warning on failure but does not throw', async () => {
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
      mockUpdateOpportunity.mockRejectedValueOnce(new Error('DynamoDB error'));

      await expect(
        syncOpportunityFoiaMarker('org-1', 'proj-1', 'opp-1', 'SENT'),
      ).resolves.not.toThrow();

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('failed to sync foiaAutomationState'),
        expect.any(Error),
      );

      consoleWarnSpy.mockRestore();
    });
  });

  describe('countFoiaSentToday', () => {
    it('counts automations sent today', async () => {
      const now = new Date();
      const todayStartMs = new Date(now.setUTCHours(0, 0, 0, 0)).getTime();
      const todayEndMs = new Date(now.setUTCHours(23, 59, 59, 999)).getTime();

      const items: FoiaAutomationDBItem[] = [
        {
          partition_key: 'FOIA_AUTOMATION',
          sort_key: 'org-1#proj-1#opp-1',
          orgId: 'org-1',
          projectId: 'proj-1',
          oppId: 'opp-1',
          state: 'SENT',
          sentAt: new Date(todayStartMs + 10000).toISOString(),
        },
        {
          partition_key: 'FOIA_AUTOMATION',
          sort_key: 'org-1#proj-1#opp-2',
          orgId: 'org-1',
          projectId: 'proj-1',
          oppId: 'opp-2',
          state: 'SENT',
          sentAt: new Date(todayEndMs - 10000).toISOString(),
        },
        {
          partition_key: 'FOIA_AUTOMATION',
          sort_key: 'org-1#proj-1#opp-3',
          orgId: 'org-1',
          projectId: 'proj-1',
          oppId: 'opp-3',
          state: 'SENT',
          sentAt: new Date(todayStartMs - 100000).toISOString(), // yesterday
        },
      ];

      mockSend.mockResolvedValueOnce({ Items: items });

      const count = await countFoiaSentToday('org-1');

      expect(count).toBe(2);
    });

    it('returns 0 when no items sent today', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const count = await countFoiaSentToday('org-1');

      expect(count).toBe(0);
    });
  });
});
