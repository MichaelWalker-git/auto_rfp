import { renderHook, act } from '@testing-library/react';
import { useEmitOpportunityEvent } from './use-emit-opportunity-event';

const mockApiMutate = jest.fn();

jest.mock('@/lib/hooks/api-helpers', () => ({
  apiMutate: (...args: unknown[]) => mockApiMutate(...args),
  buildApiUrl: (path: string) => `https://api.test${path}`,
}));

describe('useEmitOpportunityEvent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the emit result on success', async () => {
    const emitResult = { message: 'ok', emittedAt: '2026-08-05T11:25:46Z', attachmentCount: 1 };
    mockApiMutate.mockResolvedValueOnce(emitResult);

    const { result } = renderHook(() => useEmitOpportunityEvent());

    let response;
    await act(async () => {
      response = await result.current.emitEvent('org-1', 'proj-1', 'opp-1');
    });

    expect(response).toEqual(emitResult);
    expect(mockApiMutate).toHaveBeenCalledWith(
      'https://api.test/opportunity/emit-event',
      'POST',
      { orgId: 'org-1', projectId: 'proj-1', oppId: 'opp-1', force: false },
    );
    expect(result.current.isEmitting).toBe(false);
  });

  it('passes force=true through to the API', async () => {
    mockApiMutate.mockResolvedValueOnce({ message: 'ok', emittedAt: 'x', attachmentCount: 0 });

    const { result } = renderHook(() => useEmitOpportunityEvent());

    await act(async () => {
      await result.current.emitEvent('org-1', 'proj-1', 'opp-1', true);
    });

    expect(mockApiMutate).toHaveBeenCalledWith(
      expect.any(String),
      'POST',
      expect.objectContaining({ force: true }),
    );
  });

  it('rethrows API errors so callers can surface them', async () => {
    mockApiMutate.mockRejectedValueOnce(new Error('POC generation is not enabled for this organization'));

    const { result } = renderHook(() => useEmitOpportunityEvent());

    await act(async () => {
      await expect(
        result.current.emitEvent('org-1', 'proj-1', 'opp-1'),
      ).rejects.toThrow('POC generation is not enabled for this organization');
    });

    expect(result.current.isEmitting).toBe(false);
  });
});
