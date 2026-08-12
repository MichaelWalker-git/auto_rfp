import { act, renderHook } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { useUpdateSolutionPlan } from '../useUpdateSolutionPlan';

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
  mockApiMutate.mockResolvedValue({ ok: true, plan: { id: 'plan-1' } });
});

describe('useUpdateSolutionPlan', () => {
  it('PATCHes the key triple plus the edited HTML to the update endpoint', async () => {
    const { result } = renderHook(() => useUpdateSolutionPlan('org-1', 'proj-1', 'opp-1'), {
      wrapper,
    });

    await act(async () => {
      await result.current.updateSolutionPlan({ htmlContent: '<h1>Edited plan</h1>' });
    });

    expect(mockApiMutate).toHaveBeenCalledWith(
      'https://api.test/solution-plan/update?orgId=org-1',
      'PATCH',
      {
        orgId: 'org-1',
        projectId: 'proj-1',
        opportunityId: 'opp-1',
        htmlContent: '<h1>Edited plan</h1>',
      },
    );
  });
});
