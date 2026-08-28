import { renderHook, act } from '@testing-library/react';
import { useVersionRestore } from '../useVersionRestore';
import {
  RESTORE_CURRENT_MESSAGE,
  RESTORE_FAILED_MESSAGE,
  RESTORE_GENERATING_MESSAGE,
  VERSION_NOT_FOUND_MESSAGE,
} from '../../lib/version-errors';
import { makeVersion, mockApiMutate } from './test-utils';

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

describe('useVersionRestore', () => {
  it('POSTs the restore, toasts, and revalidates the list AND the plan on success', async () => {
    mockApiMutate.mockResolvedValue({ ok: true, newVersion: makeVersion() });
    const onRestored = jest.fn();
    const { result } = renderHook(() =>
      useVersionRestore('org-1', 'proj-1', 'opp-1', { onRestored }),
    );

    let outcome;
    await act(async () => {
      outcome = await result.current.restoreVersion('ver-1');
    });

    expect(mockApiMutate).toHaveBeenCalledWith(
      'https://api.test/solution-plan/version/restore?orgId=org-1',
      'POST',
      { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1', versionId: 'ver-1' },
    );
    expect(mockToast).toHaveBeenCalledWith({ title: 'Version restored' });
    expect(mockGlobalMutate).toHaveBeenCalledWith(LIST_KEY);
    expect(onRestored).toHaveBeenCalled();
    expect(outcome).toEqual({ outcome: 'restored' });
  });

  it('maps a 404 to not-found with its message and refreshes the list', async () => {
    mockApiMutate.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
    const onRestored = jest.fn();
    const { result } = renderHook(() =>
      useVersionRestore('org-1', 'proj-1', 'opp-1', { onRestored }),
    );

    let outcome;
    await act(async () => {
      outcome = await result.current.restoreVersion('ver-1');
    });

    expect(outcome).toEqual({ outcome: 'not-found', message: VERSION_NOT_FOUND_MESSAGE });
    expect(mockGlobalMutate).toHaveBeenCalledWith(LIST_KEY);
    expect(onRestored).not.toHaveBeenCalled();
  });

  it('maps the current-version 409 to its specific message', async () => {
    mockApiMutate.mockRejectedValue(
      Object.assign(new Error('conflict'), {
        status: 409,
        details: { code: 'SOLUTION_PLAN_VERSION_CURRENT' },
      }),
    );
    const { result } = renderHook(() => useVersionRestore('org-1', 'proj-1', 'opp-1'));

    let outcome;
    await act(async () => {
      outcome = await result.current.restoreVersion('ver-1');
    });

    expect(outcome).toEqual({ outcome: 'current-conflict', message: RESTORE_CURRENT_MESSAGE });
  });

  it('maps the generation-in-progress 409 to its distinct message', async () => {
    mockApiMutate.mockRejectedValue(
      Object.assign(new Error('conflict'), {
        status: 409,
        details: { code: 'SOLUTION_PLAN_GENERATING' },
      }),
    );
    const { result } = renderHook(() => useVersionRestore('org-1', 'proj-1', 'opp-1'));

    let outcome;
    await act(async () => {
      outcome = await result.current.restoreVersion('ver-1');
    });

    expect(outcome).toEqual({ outcome: 'generating', message: RESTORE_GENERATING_MESSAGE });
  });

  it('never revalidates the plan on failure — the plan view stays unchanged', async () => {
    mockApiMutate.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    const onRestored = jest.fn();
    const { result } = renderHook(() =>
      useVersionRestore('org-1', 'proj-1', 'opp-1', { onRestored }),
    );

    let outcome;
    await act(async () => {
      outcome = await result.current.restoreVersion('ver-1');
    });

    expect(outcome).toEqual({ outcome: 'error', message: RESTORE_FAILED_MESSAGE });
    expect(onRestored).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalled();
    expect(mockGlobalMutate).not.toHaveBeenCalled();
  });
});
