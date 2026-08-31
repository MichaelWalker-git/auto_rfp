import { renderHook, act } from '@testing-library/react';
import { useVersionDelete } from '../useVersionDelete';
import {
  DELETE_CURRENT_MESSAGE,
  DELETE_FAILED_MESSAGE,
  VERSION_NOT_FOUND_MESSAGE,
} from '../../lib/version-errors';
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

describe('useVersionDelete', () => {
  it('DELETEs the version, toasts, and revalidates the list on success', async () => {
    mockApiMutate.mockResolvedValue({ ok: true, versionId: 'ver-1' });
    const { result } = renderHook(() => useVersionDelete('org-1', 'proj-1', 'opp-1'));

    let outcome;
    await act(async () => {
      outcome = await result.current.deleteVersion('ver-1');
    });

    expect(mockApiMutate).toHaveBeenCalledWith(
      'https://api.test/solution-plan/version?orgId=org-1&projectId=proj-1&opportunityId=opp-1&versionId=ver-1',
      'DELETE',
    );
    expect(mockToast).toHaveBeenCalledWith({ title: 'Version deleted' });
    expect(mockGlobalMutate).toHaveBeenCalledWith(LIST_KEY);
    expect(outcome).toEqual({ outcome: 'deleted' });
  });

  it('maps a 404 to not-found (already deleted), toasts, and refreshes the list', async () => {
    mockApiMutate.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
    const { result } = renderHook(() => useVersionDelete('org-1', 'proj-1', 'opp-1'));

    let outcome;
    await act(async () => {
      outcome = await result.current.deleteVersion('ver-1');
    });

    expect(outcome).toEqual({ outcome: 'not-found', message: VERSION_NOT_FOUND_MESSAGE });
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
    expect(mockGlobalMutate).toHaveBeenCalledWith(LIST_KEY);
  });

  it('maps a 409 to current-conflict (stale list) and refreshes the list', async () => {
    mockApiMutate.mockRejectedValue(
      Object.assign(new Error('conflict'), {
        status: 409,
        details: { code: 'SOLUTION_PLAN_VERSION_CURRENT' },
      }),
    );
    const { result } = renderHook(() => useVersionDelete('org-1', 'proj-1', 'opp-1'));

    let outcome;
    await act(async () => {
      outcome = await result.current.deleteVersion('ver-1');
    });

    expect(outcome).toEqual({ outcome: 'current-conflict', message: DELETE_CURRENT_MESSAGE });
    expect(mockGlobalMutate).toHaveBeenCalledWith(LIST_KEY);
  });

  it('maps any other failure to a retryable error and keeps the list untouched', async () => {
    mockApiMutate.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    const { result } = renderHook(() => useVersionDelete('org-1', 'proj-1', 'opp-1'));

    let outcome;
    await act(async () => {
      outcome = await result.current.deleteVersion('ver-1');
    });

    expect(outcome).toEqual({ outcome: 'error', message: DELETE_FAILED_MESSAGE });
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockGlobalMutate).not.toHaveBeenCalled();
  });
});
