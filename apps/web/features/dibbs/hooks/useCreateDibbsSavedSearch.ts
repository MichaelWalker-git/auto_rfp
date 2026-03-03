'use client';

/**
 * @deprecated Use useCreateSavedSearch from '@/lib/hooks/use-saved-search' with source: 'DIBBS'.
 * This re-exports the unified hook for backward compatibility.
 */
import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { CreateSavedSearchRequest, SavedSearch } from '@auto-rfp/core';

const BASE = `${env.BASE_API_URL}/search-opportunities`;

export const useCreateDibbsSavedSearch = () => {
  const { trigger, isMutating, error, data } = useSWRMutation<
    SavedSearch,
    Error,
    string,
    CreateSavedSearchRequest
  >(`${BASE}/saved-search`, async (u, { arg }) => {
    // source: 'DIBBS' takes precedence — spread arg after so arg.source (if any) is overridden
    const payload = { ...arg, source: 'DIBBS' as const };
    const res = await authFetcher(u, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(msg || `Failed to create saved search: ${res.status}`);
    }
    return res.json() as Promise<SavedSearch>;
  });

  return { createSavedSearch: trigger, isLoading: isMutating, isError: Boolean(error), error, data };
};
