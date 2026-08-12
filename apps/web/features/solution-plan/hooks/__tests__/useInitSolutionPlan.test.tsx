import { act, renderHook } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { useInitSolutionPlan } from '../useInitSolutionPlan';

const mockApiMutate = jest.fn();
jest.mock('@/lib/hooks/api-helpers', () => ({
  apiFetcher: jest.fn(),
  apiMutate: (...args: unknown[]) => mockApiMutate(...args),
  buildApiUrl: (path: string, params?: Record<string, string>) =>
    `https://api.test/${path}?${new URLSearchParams(params).toString()}`,
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

beforeEach(() => {
  jest.clearAllMocks();
  mockApiMutate.mockResolvedValue({ ok: true, solutionPlanId: 'plan-1' });
});

describe('useInitSolutionPlan', () => {
  it('POSTs the key triple to the init endpoint', async () => {
    const { result } = renderHook(() => useInitSolutionPlan('org-1', 'proj-1', 'opp-1'), {
      wrapper,
    });

    await act(async () => {
      await result.current.initSolutionPlan();
    });

    expect(mockApiMutate).toHaveBeenCalledWith(
      'https://api.test/solution-plan/init?orgId=org-1',
      'POST',
      { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' },
    );
  });

  it('includes restart: true when requested (ADR-5 explicit restart intent)', async () => {
    const { result } = renderHook(() => useInitSolutionPlan('org-1', 'proj-1', 'opp-1'), {
      wrapper,
    });

    await act(async () => {
      await result.current.initSolutionPlan({ restart: true });
    });

    expect(mockApiMutate).toHaveBeenCalledWith(
      'https://api.test/solution-plan/init?orgId=org-1',
      'POST',
      { orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1', restart: true },
    );
  });
});
