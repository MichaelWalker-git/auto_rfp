'use client';

/**
 * @deprecated Use useUpdateSavedSearch from '@/lib/hooks/use-saved-search'.
 * This re-exports the unified hook for backward compatibility.
 */
import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { PatchType, SavedSearch } from '@auto-rfp/core';

interface EditDibbsSavedSearchArg {
  orgId: string;
  savedSearchId: string;
  patch: PatchType;
}

const BASE = `${env.BASE_API_URL}/search-opportunities`;

export const useEditDibbsSavedSearch = () => {
  const { trigger, isMutating, error, data } = useSWRMutation<
    SavedSearch,
    Error,
    string,
    EditDibbsSavedSearchArg
  >(`${BASE}/saved-search`, async (u, { arg }) => {
    const url = `${u}/${encodeURIComponent(arg.savedSearchId)}?orgId=${encodeURIComponent(arg.orgId)}&source=DIBBS`;
    const res = await authFetcher(url, { method: 'PATCH', body: JSON.stringify(arg.patch) });
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(msg || `Failed to update saved search: ${res.status}`);
    }
    return res.json() as Promise<SavedSearch>;
  });

  return { editSavedSearch: trigger, isLoading: isMutating, isError: Boolean(error), error, data };
};
