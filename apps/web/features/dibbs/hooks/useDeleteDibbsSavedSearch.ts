'use client';

/**
 * @deprecated Use useDeleteSavedSearch from '@/lib/hooks/use-saved-search'.
 * This re-exports the unified hook for backward compatibility.
 */
import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';

interface DeleteDibbsSavedSearchArg {
  orgId: string;
  savedSearchId: string;
}

const BASE = `${env.BASE_API_URL}/search-opportunities`;

export const useDeleteDibbsSavedSearch = () => {
  const { trigger, isMutating, error } = useSWRMutation<
    { ok: boolean; savedSearchId: string },
    Error,
    string,
    DeleteDibbsSavedSearchArg
  >(`${BASE}/saved-search`, async (u, { arg }) => {
    const url = `${u}/${encodeURIComponent(arg.savedSearchId)}?orgId=${encodeURIComponent(arg.orgId)}&source=DIBBS`;
    const res = await authFetcher(url, { method: 'DELETE' });
    if (!res.ok) {
      const msg = await res.text().catch(() => '');
      throw new Error(msg || `Failed to delete saved search: ${res.status}`);
    }
    return res.json() as Promise<{ ok: boolean; savedSearchId: string }>;
  });

  return { deleteSavedSearch: trigger, isLoading: isMutating, isError: Boolean(error), error };
};
