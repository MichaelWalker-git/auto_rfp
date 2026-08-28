import { renderHook, act } from '@testing-library/react';
import { useVersionLabel } from '../useVersionLabel';
import { mockApiMutate } from './test-utils';

jest.mock('@/lib/hooks/api-helpers', () => require('./test-utils').apiHelpersMock);

const mockToast = jest.fn();
jest.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mockToast }),
}));

const mockGlobalMutate = jest.fn();
jest.mock('swr', () => ({
  ...jest.requireActual('swr'),
  useSWRConfig: () => ({ mutate: mockGlobalMutate }),
}));

const LIST_KEY =
  'https://api.test/solution-plan/versions?orgId=org-1&projectId=proj-1&opportunityId=opp-1';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useVersionLabel', () => {
  it('PATCHes the label, toasts, and revalidates the list on success', async () => {
    mockApiMutate.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useVersionLabel('org-1', 'proj-1', 'opp-1'));

    let outcome;
    await act(async () => {
      outcome = await result.current.saveLabel('ver-1', '  Final review  ');
    });

    expect(mockApiMutate).toHaveBeenCalledWith(
      'https://api.test/solution-plan/version/label?orgId=org-1',
      'PATCH',
      {
        orgId: 'org-1',
        projectId: 'proj-1',
        opportunityId: 'opp-1',
        versionId: 'ver-1',
        label: 'Final review',
      },
    );
    expect(mockToast).toHaveBeenCalledWith({ title: 'Label saved' });
    expect(mockGlobalMutate).toHaveBeenCalledWith(LIST_KEY);
    expect(outcome).toEqual({ outcome: 'saved' });
  });

  it('sends an empty label as a clear operation and toasts "Label cleared"', async () => {
    mockApiMutate.mockResolvedValue({ ok: true });
    const { result } = renderHook(() => useVersionLabel('org-1', 'proj-1', 'opp-1'));

    await act(async () => {
      await result.current.saveLabel('ver-1', '   ');
    });

    expect(mockApiMutate).toHaveBeenCalledWith(
      expect.any(String),
      'PATCH',
      expect.objectContaining({ label: '' }),
    );
    expect(mockToast).toHaveBeenCalledWith({ title: 'Label cleared' });
  });

  it('maps a 400 to the validation outcome without toasting or refreshing', async () => {
    mockApiMutate.mockRejectedValue(Object.assign(new Error('bad'), { status: 400 }));
    const { result } = renderHook(() => useVersionLabel('org-1', 'proj-1', 'opp-1'));

    let outcome;
    await act(async () => {
      outcome = await result.current.saveLabel('ver-1', 'x'.repeat(101));
    });

    expect(outcome).toEqual({ outcome: 'validation' });
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockGlobalMutate).not.toHaveBeenCalled();
  });

  it('maps a 404 to not-found, toasts, and refreshes the list (vanished version)', async () => {
    mockApiMutate.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
    const { result } = renderHook(() => useVersionLabel('org-1', 'proj-1', 'opp-1'));

    let outcome;
    await act(async () => {
      outcome = await result.current.saveLabel('ver-1', 'Anything');
    });

    expect(outcome).toEqual({ outcome: 'not-found' });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
    expect(mockGlobalMutate).toHaveBeenCalledWith(LIST_KEY);
  });

  it('maps any other failure to the retryable error outcome', async () => {
    mockApiMutate.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    const { result } = renderHook(() => useVersionLabel('org-1', 'proj-1', 'opp-1'));

    let outcome;
    await act(async () => {
      outcome = await result.current.saveLabel('ver-1', 'Keep me');
    });

    expect(outcome).toEqual({ outcome: 'error' });
    expect(mockToast).not.toHaveBeenCalled();
  });
});
