import { renderHook, act, waitFor } from '@testing-library/react';
import { useApprovalAdvance } from '../use-approval-advance';

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

describe('useApprovalAdvance', () => {
  it('POSTs the advance body and revalidates the pipeline key on success', async () => {
    const { result } = renderHook(() => useApprovalAdvance('org-1'));

    let returned: boolean | undefined;
    await act(async () => {
      returned = await result.current.advance({ projectId: 'proj-1', oppId: 'opp-1', to: 'PRE_SUB_APPROVAL' });
    });

    expect(returned).toBe(true);
    expect(mockApiMutate).toHaveBeenCalledWith('dashboard/advance-rfp-approval', 'POST', {
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      to: 'PRE_SUB_APPROVAL',
    });
    expect(mockMutate).toHaveBeenCalledWith(['rfp-pipeline', 'org-1']);
    expect(result.current.error).toBeNull();
  });

  it('surfaces an error and does not revalidate when the POST fails', async () => {
    mockApiMutate.mockRejectedValue(new Error('Conflict'));
    const { result } = renderHook(() => useApprovalAdvance('org-1'));

    let returned: boolean | undefined;
    await act(async () => {
      returned = await result.current.advance({ projectId: 'p', oppId: 'o', to: 'SUBMITTED' });
    });

    expect(returned).toBe(false);
    await waitFor(() => expect(result.current.error).toBe('Conflict'));
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
