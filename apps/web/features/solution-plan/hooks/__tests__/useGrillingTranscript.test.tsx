import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { useGrillingTranscript } from '../useGrillingTranscript';

const mockApiFetcher = jest.fn();
jest.mock('@/lib/hooks/api-helpers', () => ({
  apiFetcher: (...args: unknown[]) => mockApiFetcher(...args),
  apiMutate: jest.fn(),
  buildApiUrl: (path: string, params?: Record<string, string>) =>
    `https://api.test/${path}?${new URLSearchParams(params).toString()}`,
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
);

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
