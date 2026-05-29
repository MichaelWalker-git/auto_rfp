'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type {
  ContextItem,
  ContextItemSource,
  ContextOverrideAction,
  GetOpportunityContextResponse,
} from '@auto-rfp/core';

export type { ContextItem, ContextItemSource, ContextOverrideAction };

// ─── Response / request types ─────────────────────────────────────────────────

export interface OpportunityContextData {
  suggestedItems: ContextItem[];
  pinnedItems: ContextItem[];
  excludedIds: string[];
  lastRefreshedAt?: string;
}

interface UpsertOverrideArg {
  projectId: string;
  opportunityId: string;
  orgId: string;
  item: ContextItem;
  action: ContextOverrideAction;
}

interface RemoveOverrideArg {
  projectId: string;
  opportunityId: string;
  orgId: string;
  itemId: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const BASE = `${env.BASE_API_URL}/opportunity-context`;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await authFetcher(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const res = await authFetcher(url, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function deleteJson<T>(url: string, body: unknown): Promise<T> {
  const res = await authFetcher(url, {
    method: 'DELETE',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ─── Source label helpers ─────────────────────────────────────────────────────

export const CONTEXT_SOURCE_LABELS: Record<ContextItemSource, string> = {
  KNOWLEDGE_BASE: 'Knowledge Base',
  PAST_PERFORMANCE: 'Past Performance',
  CONTENT_LIBRARY: 'Content Library',
  EXECUTIVE_BRIEF: 'Executive Brief',
};

export const CONTEXT_SOURCE_COLORS: Record<ContextItemSource, string> = {
  KNOWLEDGE_BASE: 'bg-blue-100 text-blue-800',
  PAST_PERFORMANCE: 'bg-emerald-100 text-emerald-800',
  CONTENT_LIBRARY: 'bg-violet-100 text-violet-800',
  EXECUTIVE_BRIEF: 'bg-amber-100 text-amber-800',
};

// ─── Hooks ────────────────────────────────────────────────────────────────────

/**
 * Fetch the relevant context items for an opportunity.
 *
 * @param projectId     - Project ID
 * @param opportunityId - Opportunity ID
 * @param orgId         - Organisation ID
 * @param refresh       - If true, forces a re-run of the semantic search
 */
export function useOpportunityContext(
  projectId: string | null,
  opportunityId: string | null,
  orgId: string | null,
  refresh = false,
) {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (opportunityId) params.set('opportunityId', opportunityId);
  if (orgId) params.set('orgId', orgId);
  if (refresh) params.set('refresh', 'true');

  const key =
    projectId && opportunityId && orgId
      ? `${BASE}/search?${params.toString()}`
      : null;

  const { data, error, isLoading, mutate } = useSWR<GetOpportunityContextResponse>(
    key,
    (url: string) => fetchJson<GetOpportunityContextResponse>(url),
    {
      // Don't auto-revalidate on focus — searches are expensive
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
    },
  );

  return {
    suggestedItems: data?.suggestedItems ?? [],
    pinnedItems: data?.pinnedItems ?? [],
    excludedIds: data?.excludedIds ?? [],
    lastRefreshedAt: data?.lastRefreshedAt,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

/**
 * Pin or exclude a context item.
 * After success, revalidates the context list.
 */
export function useUpsertContextOverride(
  projectId: string | null,
  opportunityId: string | null,
  orgId: string | null,
) {
  const cacheKey =
    projectId && opportunityId && orgId
      ? `${BASE}/search?projectId=${projectId}&opportunityId=${opportunityId}&orgId=${orgId}`
      : null;

  return useSWRMutation<
    { ok: boolean },
    Error,
    string | null,
    UpsertOverrideArg
  >(
    cacheKey,
    async (_key, { arg }) => {
      const result = await putJson<{ ok: boolean }>(`${BASE}/override`, arg);
      return result;
    },
  );
}

/**
 * Remove a context override (restore item to default auto-suggested state).
 * After success, revalidates the context list.
 */
export function useRemoveContextOverride(
  projectId: string | null,
  opportunityId: string | null,
  orgId: string | null,
) {
  const cacheKey =
    projectId && opportunityId && orgId
      ? `${BASE}/search?projectId=${projectId}&opportunityId=${opportunityId}&orgId=${orgId}`
      : null;

  return useSWRMutation<
    { ok: boolean; removed: boolean },
    Error,
    string | null,
    RemoveOverrideArg
  >(
    cacheKey,
    async (_key, { arg }) => {
      const result = await deleteJson<{ ok: boolean; removed: boolean }>(
        `${BASE}/override`,
        arg,
      );
      return result;
    },
  );
}

/**
 * Trigger a forced refresh of the context search.
 * Returns a function that, when called, revalidates with ?refresh=true.
 */
export function useRefreshOpportunityContext(
  projectId: string | null,
  opportunityId: string | null,
  orgId: string | null,
) {
  const params = new URLSearchParams();
  if (projectId) params.set('projectId', projectId);
  if (opportunityId) params.set('opportunityId', opportunityId);
  if (orgId) params.set('orgId', orgId);
  params.set('refresh', 'true');

  const refreshKey =
    projectId && opportunityId && orgId
      ? `${BASE}/search?${params.toString()}`
      : null;

  // The base key (without refresh=true) — this is what we want to revalidate
  const baseKey =
    projectId && opportunityId && orgId
      ? `${BASE}/search?projectId=${projectId}&opportunityId=${opportunityId}&orgId=${orgId}`
      : null;

  return useSWRMutation<GetOpportunityContextResponse, Error, string | null, void>(
    baseKey,
    async () => {
      if (!refreshKey) throw new Error('Missing required params');
      return fetchJson<GetOpportunityContextResponse>(refreshKey);
    },
  );
}
