import { renderHook, act } from '@testing-library/react';

const mockApiMutate = jest.fn();

jest.mock('@/lib/hooks/api-helpers', () => ({
  apiFetcher: jest.fn(),
  apiMutate: (...a: unknown[]) => mockApiMutate(...a),
  buildApiUrl: (path: string) => path, // identity — assert on the path
}));

// Stateful SWR mock: hold `data` and re-render the hook when `mutate` changes
// it, so the optimistic RUNNING flip is observable via `isRunning`. `mutate`
// mirrors the real SWR contract we rely on: apply `optimisticData` first, then
// the async updater's resolved value.
type ReviewData = { run: { status: string; reviewId?: string } | null; decisions: unknown[]; stale: boolean } | undefined;
let swrData: ReviewData;
let rerenderHook: (() => void) | null = null;

const mutate = jest.fn(async (updater?: unknown, opts?: { optimisticData?: (c: ReviewData) => ReviewData }) => {
  if (opts?.optimisticData) {
    swrData = opts.optimisticData(swrData);
    rerenderHook?.();
  }
  if (typeof updater === 'function') {
    swrData = await (updater as (c: ReviewData) => Promise<ReviewData>)(swrData);
    rerenderHook?.();
  }
  return swrData;
});

jest.mock('swr', () => ({
  __esModule: true,
  default: () => ({ data: swrData, error: undefined, isLoading: false, mutate }),
}));

import { useReviewRun } from '../useReviewRun';

beforeEach(() => {
  jest.clearAllMocks();
  swrData = { run: { status: 'READY', reviewId: 'old-run' }, decisions: [], stale: true };
  mockApiMutate.mockResolvedValue({ reviewId: 'new-run', status: 'RUNNING' });
});

describe('useReviewRun — re-run reflects immediately', () => {
  it('flips isRunning to true optimistically before the POST resolves', async () => {
    // Hold the POST open so we can observe the optimistic state mid-flight.
    let resolvePost: (v: unknown) => void = () => {};
    mockApiMutate.mockReturnValueOnce(new Promise((r) => { resolvePost = r; }));

    const { result, rerender } = renderHook(() => useReviewRun('o', 'p', 'opp'));
    rerenderHook = rerender;
    expect(result.current.isRunning).toBe(false);

    let pending: Promise<void>;
    act(() => {
      pending = result.current.triggerReview();
    });

    // Optimistic data applied synchronously → button should now show Running.
    expect(result.current.isRunning).toBe(true);
    expect(result.current.stale).toBe(false);

    await act(async () => {
      resolvePost({ reviewId: 'new-run', status: 'RUNNING' });
      await pending;
    });

    expect(mockApiMutate).toHaveBeenCalledTimes(1);
    expect(mockApiMutate).toHaveBeenCalledWith('compliance-review/run', 'POST');
    expect(result.current.run?.reviewId).toBe('new-run');
  });

  it('ignores a second trigger while the first is in flight (no duplicate POST)', async () => {
    let resolvePost: (v: unknown) => void = () => {};
    mockApiMutate.mockReturnValueOnce(new Promise((r) => { resolvePost = r; }));

    const { result, rerender } = renderHook(() => useReviewRun('o', 'p', 'opp'));
    rerenderHook = rerender;

    let first: Promise<void>;
    act(() => {
      first = result.current.triggerReview();
    });
    // Second click before the first settles — must be a no-op.
    act(() => {
      void result.current.triggerReview();
    });

    await act(async () => {
      resolvePost({ reviewId: 'new-run', status: 'RUNNING' });
      await first;
    });

    expect(mockApiMutate).toHaveBeenCalledTimes(1);
  });

  it('does nothing when identifiers are missing', async () => {
    const { result } = renderHook(() => useReviewRun(undefined, 'p', 'opp'));
    await act(async () => {
      await result.current.triggerReview();
    });
    expect(mockApiMutate).not.toHaveBeenCalled();
  });
});
