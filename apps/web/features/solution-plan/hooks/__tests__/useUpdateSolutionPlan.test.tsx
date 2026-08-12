import { act, renderHook } from '@testing-library/react';
import { useUpdateSolutionPlan } from '../useUpdateSolutionPlan';
import { mockApiMutate, swrWrapper as wrapper } from './test-utils';

jest.mock('@/lib/hooks/api-helpers', () => require('./test-utils').apiHelpersMock);

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
