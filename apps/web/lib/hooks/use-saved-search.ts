'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type { CreateSavedSearchRequest, SavedSearch } from '@auto-rfp/core';

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
    (error as Error & { status?: number }).status = res.status;
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

// ─── Unified saved-search endpoint ───────────────────────────────────────────
// All saved-search operations now go through /search-opportunities/saved-search
// with a `source` field in the body (SAM_GOV or DIBBS).

const BASE = `${env.BASE_API_URL}/search-opportunities`;

export const useCreateSavedSearch = () =>
  useSWRMutation<SavedSearch, Error, string, CreateSavedSearchRequest>(
    `${BASE}/saved-search`,
    async (url, { arg }) => {
      // spread arg first, then default source to SAM_GOV if not set
      const payload = { ...arg, source: arg.source ?? ('SAM_GOV' as const) };
      const res = await authFetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      return parseJsonOrThrow<SavedSearch>(res, 'Failed to create saved search');
    },
  );

export const useListSavedSearches = (args: { orgId?: string; limit?: number; nextToken?: string | null }) => {
  const { orgId, limit = 50, nextToken } = args;

  const url = orgId
    ? `${BASE}/saved-search?orgId=${encodeURIComponent(orgId)}&source=SAM_GOV&limit=${encodeURIComponent(String(limit))}${nextToken ? `&nextToken=${encodeURIComponent(nextToken)}` : ''}`
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
};

export const useDeleteSavedSearch = () =>
  useSWRMutation<
    { ok: boolean; savedSearchId?: string },
    Error,
    string,
    { orgId: string; savedSearchId: string }
  >(`${BASE}/saved-search`, async (baseUrl, { arg }) => {
    const url = `${baseUrl}/${encodeURIComponent(arg.savedSearchId)}?orgId=${encodeURIComponent(arg.orgId)}&source=SAM_GOV`;
    const res = await authFetcher(url, { method: 'DELETE' });
    return parseJsonOrThrow<{ ok: boolean; savedSearchId?: string }>(res, 'Failed to delete saved search');
  });

export const useUpdateSavedSearch = () =>
  useSWRMutation<SavedSearch, Error, string, UpdateSavedSearchRequest>(
    `${BASE}/saved-search`,
    async (baseUrl, { arg }) => {
      const url = `${baseUrl}/${encodeURIComponent(arg.savedSearchId)}?orgId=${encodeURIComponent(arg.orgId)}&source=SAM_GOV`;

      const res = await authFetcher(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(arg.patch ?? {}),
      });

      return parseJsonOrThrow<SavedSearch>(res, 'Failed to update saved search');
    },
  );
