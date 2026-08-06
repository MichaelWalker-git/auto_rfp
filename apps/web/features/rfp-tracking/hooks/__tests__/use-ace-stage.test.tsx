import { renderHook, act, waitFor } from '@testing-library/react';
import { useAceStage } from '../use-ace-stage';

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

describe('useAceStage', () => {
  it('POSTs the stage change and revalidates the pipeline key on success', async () => {
    const { result } = renderHook(() => useAceStage('org-1'));

    let returned: boolean | undefined;
    await act(async () => {
      returned = await result.current.setStage({ projectId: 'proj-1', oppId: 'opp-1', aceStage: 'Qualified' });
    });

    expect(returned).toBe(true);
    expect(mockApiMutate).toHaveBeenCalledWith('dashboard/update-ace-stage', 'POST', {
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      aceStage: 'Qualified',
    });
    expect(mockMutate).toHaveBeenCalledWith(['rfp-pipeline', 'org-1']);
    expect(result.current.error).toBeNull();
  });

  it('surfaces an error and does not revalidate when the POST fails', async () => {
    mockApiMutate.mockRejectedValue(new Error('Forbidden'));
    const { result } = renderHook(() => useAceStage('org-1'));

    let returned: boolean | undefined;
    await act(async () => {
      returned = await result.current.setStage({ projectId: 'p', oppId: 'o', aceStage: 'Committed' });
    });

    expect(returned).toBe(false);
    await waitFor(() => expect(result.current.error).toBe('Forbidden'));
    expect(mockMutate).not.toHaveBeenCalled();
  });
});
