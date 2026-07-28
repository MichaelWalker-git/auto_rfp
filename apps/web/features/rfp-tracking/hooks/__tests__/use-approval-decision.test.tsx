import { renderHook, act, waitFor } from '@testing-library/react';
import { useApprovalDecision } from '../use-approval-decision';

const mockApiMutate = jest.fn();
const mockMutate = jest.fn();

jest.mock('@/lib/hooks/api-helpers', () => ({
  apiMutate: (...args: unknown[]) => mockApiMutate(...args),
  buildApiUrl: (path: string) => path,
}));

jest.mock('swr', () => ({
  useSWRConfig: () => ({ mutate: mockMutate }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockApiMutate.mockResolvedValue(undefined);
});

describe('useApprovalDecision', () => {
  it('POSTs the gate-1 decision with orgId and revalidates the pipeline key on success', async () => {
    const { result } = renderHook(() => useApprovalDecision('org-1'));

    let returned: boolean | undefined;
    await act(async () => {
      returned = await result.current.decide({ projectId: 'proj-1', oppId: 'opp-1', gate: 'INITIAL', decision: 'APPROVE' });
    });

    expect(returned).toBe(true);
    expect(mockApiMutate).toHaveBeenCalledWith('dashboard/decide-rfp-approval', 'POST', {
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      gate: 'INITIAL',
      decision: 'APPROVE',
      reason: undefined,
    });
    expect(mockMutate).toHaveBeenCalledWith(['rfp-pipeline', 'org-1']);
    expect(result.current.error).toBeNull();
    expect(result.current.pendingOppId).toBeNull();
  });

  it('surfaces an error message and does not revalidate when the POST fails', async () => {
    mockApiMutate.mockRejectedValue(new Error('Forbidden'));
    const { result } = renderHook(() => useApprovalDecision('org-1'));

    let returned: boolean | undefined;
    await act(async () => {
      returned = await result.current.decide({ projectId: 'proj-1', oppId: 'opp-1', gate: 'INITIAL', decision: 'REJECT' });
    });

    expect(returned).toBe(false);
    await waitFor(() => expect(result.current.error).toBe('Forbidden'));
    expect(mockMutate).not.toHaveBeenCalled();
    expect(result.current.pendingOppId).toBeNull();
  });

  it('POSTs a gate-2 final approval', async () => {
    const { result } = renderHook(() => useApprovalDecision('org-9'));
    await act(async () => {
      await result.current.decide({ projectId: 'p', oppId: 'o', gate: 'FINAL', decision: 'APPROVE' });
    });
    expect(mockApiMutate).toHaveBeenCalledWith('dashboard/decide-rfp-approval', 'POST', {
      orgId: 'org-9',
      projectId: 'p',
      oppId: 'o',
      gate: 'FINAL',
      decision: 'APPROVE',
      reason: undefined,
    });
  });
});
