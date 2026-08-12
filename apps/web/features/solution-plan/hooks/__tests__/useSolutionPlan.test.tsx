import { renderHook, waitFor } from '@testing-library/react';
import { useSolutionPlan } from '../useSolutionPlan';
import type { SolutionPlanItem } from '@auto-rfp/core';
import { mockApiFetcher, swrWrapper as wrapper } from './test-utils';

jest.mock('@/lib/hooks/api-helpers', () => require('./test-utils').apiHelpersMock);

const plan = (over: Partial<SolutionPlanItem> = {}): SolutionPlanItem => ({
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

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useSolutionPlan', () => {
  it('returns the plan from the get endpoint', async () => {
    mockApiFetcher.mockResolvedValue({ ok: true, plan: plan() });

    const { result } = renderHook(() => useSolutionPlan('org-1', 'proj-1', 'opp-1'), { wrapper });

    await waitFor(() => expect(result.current.plan).not.toBeNull());
    expect(mockApiFetcher).toHaveBeenCalledWith(
      'https://api.test/solution-plan/get?orgId=org-1&projectId=proj-1&opportunityId=opp-1',
    );
    expect(result.current.status).toBe('READY');
    expect(result.current.isRunning).toBe(false);
    expect(result.current.notFound).toBe(false);
  });

  it('reports isRunning while a run is in flight', async () => {
    mockApiFetcher.mockResolvedValue({ ok: true, plan: plan({ status: 'GRILLING' }) });

    const { result } = renderHook(() => useSolutionPlan('org-1', 'proj-1', 'opp-1'), { wrapper });

    await waitFor(() => expect(result.current.isRunning).toBe(true));
  });

  it('treats a 404 as "no plan yet", not an error', async () => {
    mockApiFetcher.mockRejectedValue(Object.assign(new Error('not found'), { status: 404 }));

    const { result } = renderHook(() => useSolutionPlan('org-1', 'proj-1', 'opp-1'), { wrapper });

    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.plan).toBeNull();
    expect(result.current.error).toBeUndefined();
  });

  it('does not fetch until all identifiers are present', () => {
    const { result } = renderHook(() => useSolutionPlan(undefined, 'proj-1', 'opp-1'), {
      wrapper,
    });

    expect(mockApiFetcher).not.toHaveBeenCalled();
    expect(result.current.plan).toBeNull();
  });
});
