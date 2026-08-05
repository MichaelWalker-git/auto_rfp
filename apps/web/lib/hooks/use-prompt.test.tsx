import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { SWRConfig } from 'swr';

import { usePrompts, useSavePrompt, useDeletePrompt } from './use-prompt';

// Mock the auth fetcher so no Amplify session / network is involved
jest.mock('@/lib/auth/auth-fetcher', () => ({
  authFetcher: jest.fn(),
}));

import { authFetcher } from '@/lib/auth/auth-fetcher';

const mockAuthFetcher = authFetcher as jest.MockedFunction<typeof authFetcher>;

/** Helper to create a mock Response with json() and text() */
const mockResponse = (data: unknown, ok = true, status = ok ? 200 : 500) => {
  const body = JSON.stringify(data);
  return {
    ok,
    status,
    json: async () => data,
    text: async () => body,
  } as unknown as Response;
};

// Wrapper to clear SWR cache between tests
const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SWRConfig value={{ dedupingInterval: 0, provider: () => new Map() }}>
    {children}
  </SWRConfig>
);

describe('usePrompts', () => {
  beforeEach(() => {
    mockAuthFetcher.mockReset();
  });

  const featureSystem = [{ type: 'ANSWER', scope: 'SYSTEM', prompt: 'sys', params: [] }];
  const featureUser = [{ type: 'ANSWER', scope: 'USER', prompt: 'usr', params: [] }];
  const documentPrompts = [
    { documentType: 'COST_PROPOSAL', scope: 'SYSTEM', prompt: 'guidance', isDefault: true },
    { documentType: 'COST_PROPOSAL', scope: 'USER', prompt: 'task', isDefault: false },
  ];

  it('returns system, user, and document groups', async () => {
    mockAuthFetcher.mockResolvedValueOnce(
      mockResponse({ ok: true, items: { system: featureSystem, user: featureUser, document: documentPrompts } }),
    );

    const { result } = renderHook(() => usePrompts('org-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.system).toEqual(featureSystem);
    expect(result.current.user).toEqual(featureUser);
    expect(result.current.document).toEqual(documentPrompts);
    expect(result.current.error).toBeNull();
  });

  it('tolerates responses without a document group (older API)', async () => {
    mockAuthFetcher.mockResolvedValueOnce(
      mockResponse({ ok: true, items: { system: featureSystem, user: featureUser } }),
    );

    const { result } = renderHook(() => usePrompts('org-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.document).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('surfaces an error for malformed responses', async () => {
    mockAuthFetcher.mockResolvedValueOnce(mockResponse({ ok: true, items: { system: 'nope' } }));

    const { result } = renderHook(() => usePrompts('org-1'), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.system).toEqual([]);
    expect(result.current.document).toEqual([]);
  });

  it('does not fetch until orgId is available', () => {
    const { result } = renderHook(() => usePrompts(undefined), { wrapper });

    expect(mockAuthFetcher).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
  });
});

describe('useSavePrompt', () => {
  beforeEach(() => {
    mockAuthFetcher.mockReset();
  });

  it('saves a feature prompt with type/prompt/params body', async () => {
    const item = { type: 'ANSWER', scope: 'SYSTEM', prompt: 'updated', params: [] };
    mockAuthFetcher.mockResolvedValueOnce(mockResponse({ ok: true, item }));

    const { result } = renderHook(() => useSavePrompt('org-1'), { wrapper });

    const saved = await result.current.trigger({
      scope: 'SYSTEM',
      type: 'ANSWER',
      prompt: 'updated',
    });

    expect(saved).toEqual(item);
    const [url, options] = mockAuthFetcher.mock.calls[0];
    expect(url).toContain('/prompt/save-prompt/SYSTEM');
    expect(url).toContain('orgId=org-1');
    expect(options?.method).toBe('POST');
    expect(JSON.parse(options?.body as string)).toEqual({ type: 'ANSWER', prompt: 'updated' });
  });

  it('saves a document prompt with documentType/prompt body', async () => {
    const item = { documentType: 'COST_PROPOSAL', scope: 'SYSTEM', prompt: 'custom guidance' };
    mockAuthFetcher.mockResolvedValueOnce(mockResponse({ ok: true, item }));

    const { result } = renderHook(() => useSavePrompt('org-1'), { wrapper });

    const saved = await result.current.trigger({
      scope: 'SYSTEM',
      documentType: 'COST_PROPOSAL',
      prompt: 'custom guidance',
    });

    expect(saved).toEqual(item);
    const [url, options] = mockAuthFetcher.mock.calls[0];
    expect(url).toContain('/prompt/save-prompt/SYSTEM');
    expect(JSON.parse(options?.body as string)).toEqual({
      documentType: 'COST_PROPOSAL',
      prompt: 'custom guidance',
    });
  });

  it('rejects a document prompt exceeding the max length', async () => {
    const { result } = renderHook(() => useSavePrompt('org-1'), { wrapper });

    await expect(
      result.current.trigger({
        scope: 'SYSTEM',
        documentType: 'COST_PROPOSAL',
        prompt: 'x'.repeat(8001),
      }),
    ).rejects.toThrow(/8000/);

    expect(mockAuthFetcher).not.toHaveBeenCalled();
  });

  it('rejects an unknown documentType', async () => {
    const { result } = renderHook(() => useSavePrompt('org-1'), { wrapper });

    await expect(
      result.current.trigger({
        scope: 'SYSTEM',
        // @ts-expect-error — intentionally invalid documentType
        documentType: 'NOT_A_TYPE',
        prompt: 'text',
      }),
    ).rejects.toThrow(/documentType/i);

    expect(mockAuthFetcher).not.toHaveBeenCalled();
  });

  it('rejects an unknown feature type', async () => {
    const { result } = renderHook(() => useSavePrompt('org-1'), { wrapper });

    await expect(
      result.current.trigger({
        scope: 'SYSTEM',
        // @ts-expect-error — intentionally invalid type
        type: 'NOT_A_TYPE',
        prompt: 'text',
      }),
    ).rejects.toThrow(/type/i);

    expect(mockAuthFetcher).not.toHaveBeenCalled();
  });

  it('propagates API failures with status', async () => {
    mockAuthFetcher.mockResolvedValueOnce(mockResponse({ ok: false, error: 'boom' }, false, 400));

    const { result } = renderHook(() => useSavePrompt('org-1'), { wrapper });

    await expect(
      result.current.trigger({ scope: 'SYSTEM', type: 'ANSWER', prompt: 'p' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('useDeletePrompt', () => {
  beforeEach(() => {
    mockAuthFetcher.mockReset();
  });

  it('sends DELETE with the documentType body', async () => {
    mockAuthFetcher.mockResolvedValueOnce(mockResponse({ ok: true }));

    const { result } = renderHook(() => useDeletePrompt('org-1'), { wrapper });

    const deleted = await result.current.trigger({
      scope: 'USER',
      documentType: 'PRICE_VOLUME',
    });

    expect(deleted).toBe(true);
    const [url, options] = mockAuthFetcher.mock.calls[0];
    expect(url).toContain('/prompt/delete-prompt/USER');
    expect(url).toContain('orgId=org-1');
    expect(options?.method).toBe('DELETE');
    expect(JSON.parse(options?.body as string)).toEqual({ documentType: 'PRICE_VOLUME' });
  });

  it('rejects an invalid scope without calling the API', async () => {
    const { result } = renderHook(() => useDeletePrompt('org-1'), { wrapper });

    await expect(
      result.current.trigger({
        // @ts-expect-error — intentionally invalid scope
        scope: 'NOPE',
        documentType: 'PRICE_VOLUME',
      }),
    ).rejects.toThrow(/scope/i);

    expect(mockAuthFetcher).not.toHaveBeenCalled();
  });

  it('rejects an unknown documentType without calling the API', async () => {
    const { result } = renderHook(() => useDeletePrompt('org-1'), { wrapper });

    await expect(
      result.current.trigger({
        scope: 'USER',
        // @ts-expect-error — intentionally invalid documentType
        documentType: 'NOT_A_TYPE',
      }),
    ).rejects.toThrow(/documentType/i);

    expect(mockAuthFetcher).not.toHaveBeenCalled();
  });

  it('propagates API failures with status', async () => {
    mockAuthFetcher.mockResolvedValueOnce(mockResponse({ ok: false }, false, 403));

    const { result } = renderHook(() => useDeletePrompt('org-1'), { wrapper });

    await expect(
      result.current.trigger({ scope: 'USER', documentType: 'PRICE_VOLUME' }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
