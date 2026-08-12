import { renderHook, waitFor } from '@testing-library/react';
import { useGrillingTranscript } from '../useGrillingTranscript';
import { mockApiFetcher, swrWrapper as wrapper } from './test-utils';

jest.mock('@/lib/hooks/api-helpers', () => require('./test-utils').apiHelpersMock);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useGrillingTranscript', () => {
  it('returns the transcript messages from the transcript endpoint', async () => {
    mockApiFetcher.mockResolvedValue({
      ok: true,
      solutionPlanId: 'plan-1',
      runId: 'run-1',
      status: 'GRILLING',
      messages: [
        {
          id: 'm1',
          solutionPlanId: 'plan-1',
          runId: 'run-1',
          round: 1,
          role: 'GRILLER',
          content: 'How many users?',
        },
      ],
    });

    const { result } = renderHook(
      () => useGrillingTranscript('org-1', 'proj-1', 'opp-1'),
      { wrapper },
    );

    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(mockApiFetcher).toHaveBeenCalledWith(
      'https://api.test/solution-plan/transcript?orgId=org-1&projectId=proj-1&opportunityId=opp-1',
    );
    expect(result.current.status).toBe('GRILLING');
  });

  it('does not fetch when disabled', () => {
    const { result } = renderHook(
      () => useGrillingTranscript('org-1', 'proj-1', 'opp-1', { enabled: false }),
      { wrapper },
    );

    expect(mockApiFetcher).not.toHaveBeenCalled();
    expect(result.current.messages).toEqual([]);
  });
});
