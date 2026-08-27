import { renderHook } from '@testing-library/react';
import { act } from 'react';
import { useOpportunityHeaderActions } from '../useOpportunityHeaderActions';
import { useDeleteOpportunity, useUpdateOpportunity } from '@/lib/hooks/use-opportunities';
import type { LossData } from '@auto-rfp/core';

jest.mock('@/lib/hooks/use-opportunities');
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }));

const mockUpdate = jest.fn();
const mockUseUpdateOpportunity = useUpdateOpportunity as jest.MockedFunction<
  typeof useUpdateOpportunity
>;
const mockUseDeleteOpportunity = useDeleteOpportunity as jest.MockedFunction<
  typeof useDeleteOpportunity
>;

const baseProps = {
  oppId: 'opp-1',
  projectId: 'proj-1',
  orgId: 'org-1',
  backUrl: '/back',
};

/** A stored loss carrying the fields only the outcome dialog collects. */
const storedLossData: LossData = {
  lossReason: 'PRICE_TOO_HIGH',
  lossDate: '2026-01-29T00:00:00.000Z',
  lossReasonDetails: 'Awarded to incumbent.',
  winningContractor: 'Acme Systems',
  ourBidAmount: 250_000,
  winningBidAmount: 198_500,
  evaluationScores: { technical: 72, price: 88, overall: 78 },
};

const lostFormValues = {
  title: 'Widget Support',
  status: 'LOST' as const,
  lossReason: 'TECHNICAL_SCORE' as const,
  lossDate: '2026-02-02',
  lossReasonDetails: 'Updated detail',
  winningContractor: 'Beta Corp',
};

const submittedPatch = () => mockUpdate.mock.calls[0]![0].patch;

describe('useOpportunityHeaderActions — LossData preservation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdate.mockReset().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseUpdateOpportunity.mockReturnValue({ trigger: mockUpdate, isMutating: false } as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mockUseDeleteOpportunity.mockReturnValue({ trigger: jest.fn(), isMutating: false } as any);
  });

  /**
   * THE REGRESSION THIS FILE EXISTS FOR.
   *
   * `lossData` is one whole DynamoDB attribute, so a patch that rebuilds it from this
   * form's four fields REPLACES the stored object. That silently deleted the bid amounts
   * and evaluation scores the outcome dialog records and the FOIA comparison dashboard
   * reads — and it failed in the dangerous direction: the row stays LOST, so it still
   * counted in `pricingCoverage.total` while dropping out of `withPricing`, making
   * destroyed data look like data nobody had entered.
   */
  it('preserves bid amounts and evaluation scores it does not collect', async () => {
    const { result } = renderHook(() =>
      useOpportunityHeaderActions({ ...baseProps, currentLossData: storedLossData }),
    );

    await act(async () => {
      await result.current.handleUpdate(lostFormValues);
    });

    const { lossData } = submittedPatch();
    expect(lossData.ourBidAmount).toBe(250_000);
    expect(lossData.winningBidAmount).toBe(198_500);
    expect(lossData.evaluationScores).toEqual({ technical: 72, price: 88, overall: 78 });
  });

  it('still applies the four fields this form owns', async () => {
    const { result } = renderHook(() =>
      useOpportunityHeaderActions({ ...baseProps, currentLossData: storedLossData }),
    );

    await act(async () => {
      await result.current.handleUpdate(lostFormValues);
    });

    const { lossData } = submittedPatch();
    expect(lossData.lossReason).toBe('TECHNICAL_SCORE');
    expect(lossData.lossReasonDetails).toBe('Updated detail');
    expect(lossData.winningContractor).toBe('Beta Corp');
    expect(lossData.lossDate.slice(0, 10)).toBe('2026-02-02');
  });

  it('clears a field the user blanked rather than restoring the stored value', async () => {
    // Preservation must not become "impossible to erase a typo".
    const { result } = renderHook(() =>
      useOpportunityHeaderActions({ ...baseProps, currentLossData: storedLossData }),
    );

    await act(async () => {
      await result.current.handleUpdate({
        ...lostFormValues,
        lossReasonDetails: '   ',
        winningContractor: '',
      });
    });

    const { lossData } = submittedPatch();
    expect(lossData.lossReasonDetails).toBeUndefined();
    expect(lossData.winningContractor).toBeUndefined();
    // ...while the uncollected fields survive.
    expect(lossData.ourBidAmount).toBe(250_000);
  });

  it('works when nothing is stored yet', async () => {
    const { result } = renderHook(() =>
      useOpportunityHeaderActions({ ...baseProps, currentLossData: null }),
    );

    await act(async () => {
      await result.current.handleUpdate(lostFormValues);
    });

    const { lossData } = submittedPatch();
    expect(lossData.lossReason).toBe('TECHNICAL_SCORE');
    expect(lossData.ourBidAmount).toBeUndefined();
  });

  it('preserves a genuinely recorded zero', async () => {
    // 0 is a real bid amount, distinct from "not known". A truthiness-based spread
    // would drop it.
    const { result } = renderHook(() =>
      useOpportunityHeaderActions({
        ...baseProps,
        currentLossData: { ...storedLossData, ourBidAmount: 0 },
      }),
    );

    await act(async () => {
      await result.current.handleUpdate(lostFormValues);
    });

    expect(submittedPatch().lossData.ourBidAmount).toBe(0);
  });

  it('does not send lossData for a win', async () => {
    const { result } = renderHook(() =>
      useOpportunityHeaderActions({ ...baseProps, currentLossData: storedLossData }),
    );

    await act(async () => {
      await result.current.handleUpdate({
        title: 'Widget Support',
        status: 'WON',
        contractValue: '412000',
        awardDate: '2026-03-01',
      });
    });

    const patch = submittedPatch();
    expect(patch.winData).toBeDefined();
    expect(patch.lossData).toBeUndefined();
  });
});
