import { renderHook, act, waitFor } from '@testing-library/react';

const mockApiMutate = jest.fn();
const mockMutateHistory = jest.fn();
let mockCanEdit = false;

jest.mock('@/lib/hooks/api-helpers', () => ({
  apiFetcher: jest.fn(),
  apiMutate: (...a: unknown[]) => mockApiMutate(...a),
  buildApiUrl: (path: string) => path, // identity — assert on the path
}));

// SWR: return a stable history + capture the mutation trigger.
jest.mock('swr', () => ({
  __esModule: true,
  default: () => ({ data: { messages: [] }, isLoading: false, mutate: mockMutateHistory }),
}));
jest.mock('swr/mutation', () => ({
  __esModule: true,
  default: (_key: string | null, fetcher: (url: string, opts: { arg: unknown }) => Promise<unknown>) => ({
    trigger: (arg: unknown) => fetcher(_key as string, { arg }),
    isMutating: false,
  }),
}));

jest.mock('@/components/permission-wrapper', () => ({
  usePermission: () => mockCanEdit,
}));

import { useUnifiedChat } from '../useUnifiedChat';

beforeEach(() => {
  jest.clearAllMocks();
  mockApiMutate.mockResolvedValue({ intent: 'REVIEW', answer: 'ok', findings: [] });
  mockMutateHistory.mockResolvedValue(undefined);
});

describe('useUnifiedChat — permission-based routing', () => {
  it('routes editors (proposal:edit) to the package-edit chat endpoint', async () => {
    mockCanEdit = true;
    const { result } = renderHook(() => useUnifiedChat('o', 'p', 'opp'));
    expect(result.current.canEdit).toBe(true);
    await act(async () => {
      await result.current.sendMessage('change the email everywhere');
    });
    expect(mockApiMutate).toHaveBeenCalledWith('package-edit/chat', 'POST', {
      message: 'change the email everywhere',
    });
    await waitFor(() => expect(mockMutateHistory).toHaveBeenCalled());
  });

  it('routes read-only users to the compliance-review chat endpoint', async () => {
    mockCanEdit = false;
    const { result } = renderHook(() => useUnifiedChat('o', 'p', 'opp'));
    expect(result.current.canEdit).toBe(false);
    await act(async () => {
      await result.current.sendMessage('does it meet section L?');
    });
    expect(mockApiMutate).toHaveBeenCalledWith('compliance-review/chat', 'POST', {
      message: 'does it meet section L?',
    });
  });

  it('does not send an empty message', async () => {
    mockCanEdit = true;
    const { result } = renderHook(() => useUnifiedChat('o', 'p', 'opp'));
    await act(async () => {
      await result.current.sendMessage('   ');
    });
    expect(mockApiMutate).not.toHaveBeenCalled();
  });
});
