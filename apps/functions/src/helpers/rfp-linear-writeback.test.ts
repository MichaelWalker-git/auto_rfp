const mockSwap = jest.fn();
jest.mock('./linear', () => ({
  swapLinearGateLabelByIdentifier: (...args: unknown[]) => mockSwap(...args),
}));

process.env.RFP_SYNC_LINEAR_ORG_ID = 'linear-org-1';

import { writeBackApprovalToLinear } from './rfp-linear-writeback';

describe('writeBackApprovalToLinear', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSwap.mockResolvedValue(true);
    process.env.RFP_SYNC_LINEAR_ORG_ID = 'linear-org-1';
  });

  it('swaps to the "I Approved" label for a Linear-synced I_APPROVED transition', async () => {
    const result = await writeBackApprovalToLinear({
      item: { oppId: 'linear-hor-1', id: 'linear-hor-1', noticeId: 'HOR-1' },
      to: 'I_APPROVED',
    });

    expect(mockSwap).toHaveBeenCalledWith(
      'linear-org-1',
      'HOR-1',
      'I Approved',
      expect.arrayContaining(['Initial Approval', 'Pre Sub Approval', 'II Approved', 'Not Approved']),
    );
    expect(result).toEqual({ updated: true });
  });

  it('swaps to the "Not Approved" label on a rejection', async () => {
    await writeBackApprovalToLinear({
      item: { oppId: 'linear-hor-2', id: 'linear-hor-2', noticeId: 'HOR-2' },
      to: 'NOT_APPROVED',
    });
    expect(mockSwap).toHaveBeenCalledWith('linear-org-1', 'HOR-2', 'Not Approved', expect.not.arrayContaining(['Not Approved']));
  });

  it('is a no-op for SUBMITTED (no gate label — expressed via Linear status)', async () => {
    const result = await writeBackApprovalToLinear({
      item: { oppId: 'linear-hor-3', id: 'linear-hor-3', noticeId: 'HOR-3' },
      to: 'SUBMITTED',
    });
    expect(mockSwap).not.toHaveBeenCalled();
    expect(result.updated).toBe(false);
  });

  it('is a no-op for a non-Linear opportunity (oppId not prefixed linear-)', async () => {
    const result = await writeBackApprovalToLinear({
      item: { oppId: 'sam-123', id: 'sam-123', noticeId: 'notice-9' },
      to: 'I_APPROVED',
    });
    expect(mockSwap).not.toHaveBeenCalled();
    expect(result.updated).toBe(false);
  });

  it('swallows a Linear failure and reports updated=false', async () => {
    mockSwap.mockRejectedValueOnce(new Error('Linear 503'));
    const result = await writeBackApprovalToLinear({
      item: { oppId: 'linear-hor-4', id: 'linear-hor-4', noticeId: 'HOR-4' },
      to: 'I_APPROVED',
    });
    expect(result).toEqual({ updated: false, reason: 'Linear 503' });
  });

  it('is a no-op when RFP_SYNC_LINEAR_ORG_ID is not configured', async () => {
    delete process.env.RFP_SYNC_LINEAR_ORG_ID;
    const result = await writeBackApprovalToLinear({
      item: { oppId: 'linear-hor-5', id: 'linear-hor-5', noticeId: 'HOR-5' },
      to: 'I_APPROVED',
    });
    expect(mockSwap).not.toHaveBeenCalled();
    expect(result.updated).toBe(false);
  });
});
