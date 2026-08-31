import { renderHook, waitFor } from '@testing-library/react';
import type { SolutionPlanVersionListResponse } from '@auto-rfp/core';
import { SYSTEM_CREATED_BY, SYSTEM_CREATED_BY_NAME } from '@auto-rfp/core';
import { useVersionList, versionListKey } from '../useVersionList';
import { mockApiFetcher, swrWrapper as wrapper } from './test-utils';

jest.mock('@/lib/hooks/api-helpers', () => require('./test-utils').apiHelpersMock);

const listResponse: SolutionPlanVersionListResponse = {
  ok: true,
  versions: [
    {
      versionId: 'ver-3',
      versionNumber: 3,
      origin: 'manual-save',
      label: 'Final review',
      createdBy: 'user-1',
      createdByName: 'Jane Doe',
      createdAt: '2026-08-27T10:00:00.000Z',
    },
    {
      versionId: 'ver-2',
      versionNumber: 2,
      origin: 'generation',
      createdBy: SYSTEM_CREATED_BY,
      createdByName: SYSTEM_CREATED_BY_NAME,
      createdAt: '2026-08-26T10:00:00.000Z',
    },
  ],
  currentVersionId: 'ver-3',
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('versionListKey', () => {
  it('builds the C1 list URL from the key triple', () => {
    expect(versionListKey('org-1', 'proj-1', 'opp-1')).toBe(
      'https://api.test/solution-plan/versions?orgId=org-1&projectId=proj-1&opportunityId=opp-1',
    );
  });

  it('is null until every identifier is present', () => {
    expect(versionListKey(undefined, 'proj-1', 'opp-1')).toBeNull();
  });
});

describe('useVersionList', () => {
  it('returns versions and currentVersionId from the list endpoint', async () => {
    mockApiFetcher.mockResolvedValue(listResponse);

    const { result } = renderHook(() => useVersionList('org-1', 'proj-1', 'opp-1'), { wrapper });

    await waitFor(() => expect(result.current.versions).toHaveLength(2));
    expect(mockApiFetcher).toHaveBeenCalledWith(
      'https://api.test/solution-plan/versions?orgId=org-1&projectId=proj-1&opportunityId=opp-1',
    );
    expect(result.current.currentVersionId).toBe('ver-3');
    expect(result.current.versions[1].createdByName).toBe(SYSTEM_CREATED_BY_NAME);
    expect(result.current.versions[0].createdAt).toEqual(expect.any(String));
  });

  it('does not fetch until all identifiers are present', () => {
    const { result } = renderHook(() => useVersionList(undefined, 'proj-1', 'opp-1'), { wrapper });

    expect(mockApiFetcher).not.toHaveBeenCalled();
    expect(result.current.versions).toEqual([]);
    expect(result.current.currentVersionId).toBeNull();
  });

  it('surfaces a list fetch failure as error', async () => {
    mockApiFetcher.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));

    const { result } = renderHook(() => useVersionList('org-1', 'proj-1', 'opp-1'), { wrapper });

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.versions).toEqual([]);
  });

  it('revalidates when the plan transitions from running to ready (W7)', async () => {
    mockApiFetcher.mockResolvedValue(listResponse);

    const { result, rerender } = renderHook(
      ({ isPlanRunning }: { isPlanRunning: boolean }) =>
        useVersionList('org-1', 'proj-1', 'opp-1', { isPlanRunning }),
      { wrapper, initialProps: { isPlanRunning: true } },
    );

    await waitFor(() => expect(result.current.versions).toHaveLength(2));
    const callsWhileRunning = mockApiFetcher.mock.calls.length;

    rerender({ isPlanRunning: false });

    await waitFor(() =>
      expect(mockApiFetcher.mock.calls.length).toBeGreaterThan(callsWhileRunning),
    );
  });

  it('does not revalidate on rerenders without a ready transition', async () => {
    mockApiFetcher.mockResolvedValue(listResponse);

    const { result, rerender } = renderHook(
      ({ isPlanRunning }: { isPlanRunning: boolean }) =>
        useVersionList('org-1', 'proj-1', 'opp-1', { isPlanRunning }),
      { wrapper, initialProps: { isPlanRunning: false } },
    );

    await waitFor(() => expect(result.current.versions).toHaveLength(2));
    const initialCalls = mockApiFetcher.mock.calls.length;

    rerender({ isPlanRunning: false });

    expect(mockApiFetcher.mock.calls.length).toBe(initialCalls);
  });
});
