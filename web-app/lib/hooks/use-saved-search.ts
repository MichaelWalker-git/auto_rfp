'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type { CreateSavedSearchRequest, SavedSearch } from '@auto-rfp/shared';

export type ListSavedSearchesResponse = {
  items: SavedSearch[];
  nextToken: string | null;
  count: number;
};

type UpdateSavedSearchRequest = {
  orgId: string;
  savedSearchId: string;
  patch: Partial<Pick<SavedSearch, 'name' | 'criteria' | 'frequency' | 'autoImport' | 'notifyEmails' | 'isEnabled'>>;
};

async function parseJsonOrThrow<T>(res: Response, fallbackMsg: string): Promise<T> {
  if (!res.ok) {
    const message = await res.text().catch(() => '');
    const error = new Error(message || fallbackMsg) as Error & { status?: number };
    (error as any).status = res.status;
    throw error;
  }

  const raw = await res.text().catch(() => '');
  if (!raw) throw new Error('Empty response');

  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error('Invalid JSON response');
  }
}

export function useCreateSavedSearch() {
  return useSWRMutation<SavedSearch, any, string, CreateSavedSearchRequest>(
    `${env.BASE_API_URL}/samgov/create-saved-search`,
    async (url, { arg }) => {
      const res = await authFetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(arg),
      });

      return parseJsonOrThrow<SavedSearch>(res, 'Failed to create saved search');
    },
  );
}

export function useListSavedSearches(args: { orgId?: string; limit?: number; nextToken?: string | null }) {
  const { orgId, limit = 50, nextToken } = args;

  const url = orgId
    ? `${env.BASE_API_URL}/samgov/list-saved-search?orgId=${encodeURIComponent(
      orgId,
    )}&limit=${encodeURIComponent(String(limit))}${nextToken ? `&nextToken=${encodeURIComponent(nextToken)}` : ''}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<ListSavedSearchesResponse>(
    url,
    async (u) => {
      const res = await authFetcher(u, { method: 'GET' });
      return parseJsonOrThrow<ListSavedSearchesResponse>(res, 'Failed to list saved searches');
    },
    { revalidateOnFocus: false },
  );

  return {
    items: data?.items ?? [],
    count: data?.count ?? 0,
    nextToken: data?.nextToken ?? null,
    isLoading,
    error,
    refresh: mutate,
  };
}

export function useDeleteSavedSearch() {
  return useSWRMutation<
    { ok: boolean; savedSearchId?: string },
    any,
    string,
    { orgId: string; savedSearchId: string }
  >(`${env.BASE_API_URL}/samgov/delete-saved-search`, async (baseUrl, { arg }) => {
    const url = `${baseUrl}/${encodeURIComponent(arg.savedSearchId)}?orgId=${encodeURIComponent(arg.orgId)}`;
    const res = await authFetcher(url, { method: 'DELETE' });
    return parseJsonOrThrow<{ ok: boolean; savedSearchId?: string }>(res, 'Failed to delete saved search');
  });
}

export function useUpdateSavedSearch() {
  return useSWRMutation<SavedSearch, any, string, UpdateSavedSearchRequest>(
    `${env.BASE_API_URL}/samgov/edit-saved-search`,
    async (baseUrl, { arg }) => {
      const url = `${baseUrl}/${encodeURIComponent(arg.savedSearchId)}?orgId=${encodeURIComponent(arg.orgId)}`;

      const res = await authFetcher(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(arg.patch ?? {}),
      });

      return parseJsonOrThrow<SavedSearch>(res, 'Failed to update saved search');
    },
  );
}