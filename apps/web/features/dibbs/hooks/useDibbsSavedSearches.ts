'use client';

/**
 * @deprecated Use useListSavedSearches from '@/lib/hooks/use-saved-search' with source=DIBBS.
 * This re-exports the unified hook for backward compatibility.
 */
import useSWR from 'swr';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { SavedSearch } from '@auto-rfp/core';

interface DibbsSavedSearchesResponse {
  items: SavedSearch[];
  count: number;
}

const BASE = `${env.BASE_API_URL}/search-opportunities`;

export const useDibbsSavedSearches = (orgId: string | undefined) => {
  const url = orgId
    ? `${BASE}/saved-search?orgId=${encodeURIComponent(orgId)}&source=DIBBS`
    : null;

  const { data, error, isLoading, mutate } = useSWR<DibbsSavedSearchesResponse>(
    url,
    async (u: string) => {
      const res = await authFetcher(u, { method: 'GET' });
      if (!res.ok) throw new Error(`Failed to list DIBBS saved searches: ${res.status}`);
      return res.json() as Promise<DibbsSavedSearchesResponse>;
    },
    { revalidateOnFocus: false },
  );

  return {
    savedSearches: data?.items ?? [],
    count:         data?.count ?? 0,
    isLoading,
    isError:       Boolean(error),
    error:         error as Error | undefined,
    mutate,
  };
};
