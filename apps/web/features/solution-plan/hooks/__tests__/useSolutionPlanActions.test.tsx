import { act, renderHook } from '@testing-library/react';
import { useSolutionPlanActions } from '../useSolutionPlanActions';
import type { SolutionPlanItem } from '@auto-rfp/core';

const mockInitSolutionPlan = jest.fn();
jest.mock('../useInitSolutionPlan', () => ({
  useInitSolutionPlan: () => ({
    initSolutionPlan: mockInitSolutionPlan,
    isInitializing: false,
  }),
}));

const mockConfirm = jest.fn();
jest.mock('@/components/ui/confirm-dialog', () => ({
  useConfirmDialog: () => ({
    confirm: mockConfirm,
    ConfirmDialog: () => null,
  }),
}));

const mockToast = jest.fn();
jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const makePlan = (over: Partial<SolutionPlanItem> = {}): SolutionPlanItem => ({
  id: 'plan-1',
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  status: 'READY',
  isStale: false,
  runId: 'run-1',
  version: 1,
  isUserEdited: false,
  ...over,
});

const renderActions = (plan: SolutionPlanItem | null, refresh = jest.fn()) => ({
  refresh,
  ...renderHook(() =>
    useSolutionPlanActions('org-1', 'proj-1', 'opp-1', { plan, refresh }),
  ),
});

beforeEach(() => {
  jest.clearAllMocks();
  mockInitSolutionPlan.mockResolvedValue({ ok: true });
  mockConfirm.mockResolvedValue(true);
});

describe('useSolutionPlanActions', () => {
  it('starts a run and refreshes the plan on success', async () => {
    const { result, refresh } = renderActions(null);

    await act(async () => result.current.startRun());

    expect(mockInitSolutionPlan).toHaveBeenCalledWith(undefined);
    expect(refresh).toHaveBeenCalled();
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('offers a restart on 409 and re-inits with restart: true when confirmed (ADR-5)', async () => {
    const conflict = Object.assign(new Error('run in progress'), { status: 409 });
    mockInitSolutionPlan.mockRejectedValueOnce(conflict).mockResolvedValueOnce({ ok: true });
    const { result } = renderActions(null);

    await act(async () => result.current.startRun());

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ confirmLabel: 'Restart run', variant: 'destructive' }),
    );
    expect(mockInitSolutionPlan).toHaveBeenLastCalledWith({ restart: true });
  });

  it('does not restart when the 409 confirm is declined', async () => {
    const conflict = Object.assign(new Error('run in progress'), { status: 409 });
    mockInitSolutionPlan.mockRejectedValue(conflict);
    mockConfirm.mockResolvedValue(false);
    const { result } = renderActions(null);

    await act(async () => result.current.startRun());

    expect(mockInitSolutionPlan).toHaveBeenCalledTimes(1);
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('toasts on non-409 init failures', async () => {
    const error = Object.assign(new Error('No processed solicitation documents'), {
      status: 400,
    });
    mockInitSolutionPlan.mockRejectedValue(error);
    const { result } = renderActions(null);

    await act(async () => result.current.startRun());

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: 'destructive',
        description: 'No processed solicitation documents',
      }),
    );
  });

  it('warns that manual edits are permanently lost when regenerating an edited plan (ADR-4)', async () => {
    const { result } = renderActions(makePlan({ isUserEdited: true }));

    await act(async () => result.current.regenerate());

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringMatching(/manual edits will be permanently lost/i),
        variant: 'destructive',
      }),
    );
    expect(mockInitSolutionPlan).toHaveBeenCalled();
  });

  it('uses a neutral confirm and skips init when regenerate is cancelled', async () => {
    mockConfirm.mockResolvedValue(false);
    const { result } = renderActions(makePlan({ isUserEdited: false }));

    await act(async () => result.current.regenerate());

    expect(mockConfirm).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.not.stringMatching(/permanently lost/i),
        variant: 'default',
      }),
    );
    expect(mockInitSolutionPlan).not.toHaveBeenCalled();
  });
});
