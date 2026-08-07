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

import { setAceStageLocal, syncAceStageToPartnerCentral, ensureAceTechnicalValidation } from './ace-stage';
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

  it('falls back to title / null value / now / null for missing fields', async () => {
    await syncAceStageToPartnerCentral({
      ...ids,
      item: { oppId: 'opp-1', id: 'opp-1', title: 'Fallback Title' } as OpportunityItem,
      aceStage: 'Prospect',
    });
    expect(mockSyncOpportunityToApn).toHaveBeenCalledWith(
      expect.objectContaining({
        customerName: 'Fallback Title',
        // No baseAndAllOptionsValue on the item ⇒ pass null so the APN client
        // omits ExpectedCustomerSpend rather than fabricating a $0/placeholder.
        opportunityValue: null,
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

describe('ensureAceTechnicalValidation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSyncOpportunityToApn.mockResolvedValue(undefined);
    mockUpdateOpportunity.mockImplementation(async ({ patch }: { patch: Record<string, unknown> }) => ({
      item: { ...baseItem, ...patch },
    }));
    // After a local write + PC push, the re-read reports a synced PC opportunity.
    mockGetOpportunity.mockResolvedValue({ item: { ...baseItem, apnOpportunityId: 'O123', apnSyncError: null } });
  });

  it("returns 'error' (never throws) when the opportunity is missing", async () => {
    mockGetOpportunity.mockResolvedValue(null);
    await expect(ensureAceTechnicalValidation(ids)).resolves.toBe('error');
    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
  });

  it("sets the stage and returns 'created' when no PC opportunity existed", async () => {
    // First read: no apnOpportunityId. Subsequent reads (post-sync): synced.
    mockGetOpportunity
      .mockResolvedValueOnce({ item: { ...baseItem } })
      .mockResolvedValue({ item: { ...baseItem, apnOpportunityId: 'O123', apnSyncError: null } });

    const outcome = await ensureAceTechnicalValidation(ids);

    expect(outcome).toBe('created');
    const { patch } = mockUpdateOpportunity.mock.calls[0][0];
    expect(patch.aceStage).toBe('Technical Validation');
    expect(patch.aceStageHistory[0]).toMatchObject({ to: 'Technical Validation', source: 'AUTO_SUBMITTED', changedBy: 'system' });
    expect(mockSyncOpportunityToApn).toHaveBeenCalledTimes(1);
  });

  it("returns 'advanced' when a PC opportunity already existed", async () => {
    mockGetOpportunity.mockResolvedValue({ item: { ...baseItem, apnOpportunityId: 'O555' } });

    const outcome = await ensureAceTechnicalValidation(ids);

    expect(outcome).toBe('advanced');
    expect(mockSyncOpportunityToApn).toHaveBeenCalledTimes(1);
  });

  it("skips (no writes) when already at Technical Validation AND a PC opp exists", async () => {
    mockGetOpportunity.mockResolvedValue({
      item: { ...baseItem, aceStage: 'Technical Validation', apnOpportunityId: 'O999' },
    });

    const outcome = await ensureAceTechnicalValidation(ids);

    expect(outcome).toBe('skipped');
    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
    expect(mockSyncOpportunityToApn).not.toHaveBeenCalled();
  });

  it("retries the PC push (no new history) when stage is set locally but the PC opp is missing", async () => {
    // Simulates a record stranded by an earlier failed push: stage set, no apnId.
    mockGetOpportunity.mockResolvedValue({
      item: { ...baseItem, aceStage: 'Technical Validation', apnOpportunityId: undefined, apnSyncError: 'BUSINESS_VALIDATION_EXCEPTION' },
    });

    const outcome = await ensureAceTechnicalValidation(ids);

    expect(outcome).toBe('created');
    // Stage already correct locally — no new transition appended.
    expect(mockUpdateOpportunity).not.toHaveBeenCalled();
    // But the PC push IS retried.
    expect(mockSyncOpportunityToApn).toHaveBeenCalledTimes(1);
  });

  it("returns 'error' (never throws) when a local write throws", async () => {
    mockGetOpportunity.mockResolvedValue({ item: { ...baseItem } });
    mockUpdateOpportunity.mockRejectedValueOnce(new Error('dynamo down'));

    await expect(ensureAceTechnicalValidation(ids)).resolves.toBe('error');
  });
});
