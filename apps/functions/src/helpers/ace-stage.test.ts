const mockGetOpportunity = jest.fn();
const mockUpdateOpportunity = jest.fn();
jest.mock('@/helpers/opportunity', () => ({
  getOpportunity: (...args: unknown[]) => mockGetOpportunity(...args),
  updateOpportunity: (...args: unknown[]) => mockUpdateOpportunity(...args),
}));

const mockSyncOpportunityToApn = jest.fn();
jest.mock('@/helpers/apn-db', () => ({
  syncOpportunityToApn: (...args: unknown[]) => mockSyncOpportunityToApn(...args),
}));

jest.mock('@/helpers/date', () => ({
  nowIso: () => '2026-08-05T12:00:00.000Z',
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { setAceStageLocal, syncAceStageToPartnerCentral } from './ace-stage';
import type { OpportunityItem } from '@auto-rfp/core';

const ids = { orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1' };

const baseItem: Partial<OpportunityItem> = {
  oppId: 'opp-1',
  id: 'opp-1',
  title: 'Cloud Migration RFP',
  organizationName: 'City of Springfield',
  baseAndAllOptionsValue: 250000,
  responseDeadlineIso: '2026-09-01T00:00:00Z',
};

describe('setAceStageLocal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetOpportunity.mockResolvedValue({ item: { ...baseItem } });
    mockUpdateOpportunity.mockImplementation(async ({ patch }: { patch: Record<string, unknown> }) => ({
      item: { ...baseItem, ...patch },
    }));
  });

  it('throws when the opportunity does not exist', async () => {
    mockGetOpportunity.mockResolvedValueOnce(null);
    await expect(
      setAceStageLocal({ ...ids, to: 'Prospect', changedBy: 'user-1', source: 'GATE_APPROVAL' }),
    ).rejects.toThrow('Opportunity not found');
    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
  });

  it('persists the stage with a first transition (from=null)', async () => {
    const item = await setAceStageLocal({
      ...ids, to: 'Prospect', changedBy: 'user-1', source: 'GATE_APPROVAL',
    });
    expect(mockUpdateOpportunity).toHaveBeenCalledWith(
      expect.objectContaining({
        ...ids,
        patch: {
          aceStage: 'Prospect',
          aceStageHistory: [
            {
              from: null,
              to: 'Prospect',
              changedAt: '2026-08-05T12:00:00.000Z',
              changedBy: 'user-1',
              source: 'GATE_APPROVAL',
            },
          ],
        },
      }),
    );
    expect(item.aceStage).toBe('Prospect');
  });

  it('appends to existing history and records the previous stage as from', async () => {
    const priorTransition = {
      from: null, to: 'Prospect', changedAt: '2026-08-01T00:00:00Z',
      changedBy: 'user-1', source: 'GATE_APPROVAL',
    };
    mockGetOpportunity.mockResolvedValueOnce({
      item: { ...baseItem, aceStage: 'Prospect', aceStageHistory: [priorTransition] },
    });

    await setAceStageLocal({ ...ids, to: 'Qualified', changedBy: 'user-2', source: 'MANUAL' });

    const { patch } = mockUpdateOpportunity.mock.calls[0][0];
    expect(patch.aceStage).toBe('Qualified');
    expect(patch.aceStageHistory).toHaveLength(2);
    expect(patch.aceStageHistory[0]).toEqual(priorTransition);
    expect(patch.aceStageHistory[1]).toMatchObject({
      from: 'Prospect', to: 'Qualified', changedBy: 'user-2', source: 'MANUAL',
    });
  });
});

describe('syncAceStageToPartnerCentral', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSyncOpportunityToApn.mockResolvedValue(undefined);
    mockGetOpportunity.mockResolvedValue({
      item: { ...baseItem, apnOpportunityId: 'O123', apnSyncError: null },
    });
  });

  it('maps item fields into the APN sync args', async () => {
    await syncAceStageToPartnerCentral({
      ...ids,
      item: { ...baseItem, apnOpportunityId: 'O123' } as OpportunityItem,
      aceStage: 'Qualified',
    });
    expect(mockSyncOpportunityToApn).toHaveBeenCalledWith(
      expect.objectContaining({
        ...ids,
        customerName: 'City of Springfield',
        opportunityTitle: 'Cloud Migration RFP',
        opportunityValue: 250000,
        expectedCloseDate: '2026-09-01T00:00:00Z',
        existingApnId: 'O123',
        aceStage: 'Qualified',
      }),
    );
  });

  it('falls back to title / 0 / now / null for missing fields', async () => {
    await syncAceStageToPartnerCentral({
      ...ids,
      item: { oppId: 'opp-1', id: 'opp-1', title: 'Fallback Title' } as OpportunityItem,
      aceStage: 'Prospect',
    });
    expect(mockSyncOpportunityToApn).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: 'Fallback Title',
        opportunityValue: 0,
        expectedCloseDate: '2026-08-05T12:00:00.000Z',
        existingApnId: null,
      }),
    );
  });

  it('returns true when the item has an apnOpportunityId and no sync error afterwards', async () => {
    const synced = await syncAceStageToPartnerCentral({
      ...ids, item: baseItem as OpportunityItem, aceStage: 'Prospect',
    });
    expect(synced).toBe(true);
  });

  it('returns false when a sync error was recorded', async () => {
    mockGetOpportunity.mockResolvedValueOnce({
      item: { ...baseItem, apnOpportunityId: 'O123', apnSyncError: 'AccessDenied' },
    });
    const synced = await syncAceStageToPartnerCentral({
      ...ids, item: baseItem as OpportunityItem, aceStage: 'Prospect',
    });
    expect(synced).toBe(false);
  });

  it('never throws — returns false if the underlying sync helper rejects', async () => {
    mockSyncOpportunityToApn.mockRejectedValueOnce(new Error('network down'));
    const synced = await syncAceStageToPartnerCentral({
      ...ids, item: baseItem as OpportunityItem, aceStage: 'Prospect',
    });
    expect(synced).toBe(false);
  });
});
