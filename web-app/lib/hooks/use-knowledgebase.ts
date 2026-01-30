'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { KnowledgeBase, KnowledgeBaseItem } from '@auto-rfp/shared';

const BASE = `${env.BASE_API_URL}/knowledgebase`;

const fetcher = async (url: string) => {
  const res = await authFetcher(url);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err: any = new Error('Failed request');
    err.status = res.status;
    err.details = text;
    throw err;
  }

  return res.json();
};

export function useCreateKnowledgeBase(orgId: string) {
  return useSWRMutation(
    `${BASE}/create-knowledgebase?orgId=${orgId}`,
    async (url, { arg }: { arg: Partial<KnowledgeBase> }) => {
      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(arg),
      });

      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || 'Failed to create knowledge base');
      }

      return res.json() as Promise<KnowledgeBase>;
    },
  );
}

export function useDeleteKnowledgeBase() {
  return useSWRMutation(
    `${BASE}/delete-knowledgebase`,
    async (url, { arg }: { arg: KnowledgeBase }) => {
      const res = await authFetcher(url, {
        method: 'DELETE',
        body: JSON.stringify(arg),
      });

      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || 'Failed to delete knowledge base');
      }

      return res.json();
    },
  );
}
export function useEditKnowledgeBase() {
  return useSWRMutation(
    `${BASE}/edit-knowledgebase`,
    async (url, { arg }: { arg: KnowledgeBaseItem }) => {
      const res = await authFetcher(url, {
        method: 'PATCH',
        body: JSON.stringify(arg),
      });

      if (!res.ok) {
        const message = await res.text();
        throw new Error(message || 'Failed to edit knowledge base');
      }

      return res.json() as Promise<KnowledgeBase>;
    },
  );
}

export function useKnowledgeBases(orgId: string | null) {
  const shouldFetch = !!orgId;

  const { data, error, isLoading, mutate } = useSWR<KnowledgeBase[]>(
    shouldFetch ? `${BASE}/get-knowledgebases?orgId=${orgId}` : null,
    fetcher,
    {
      revalidateOnFocus: false,
    },
  );

  return {
    data,
    error,
    isLoading,
    mutate,
  };
}

//
// ================================
// GET single KnowledgeBase
// (GET /knowledgebase/get-knowledgebase)
// ================================
//

export function useKnowledgeBase(kbId: string | null, orgId: string | null) {
  const shouldFetch = !!kbId && !!orgId;

  const { data, error, isLoading, mutate } = useSWR<KnowledgeBase>(
    shouldFetch
      ? `${BASE}/get-knowledgebase?orgId=${orgId}&kbId=${kbId}`
      : null,
    fetcher,
    {
      revalidateOnFocus: false,
    },
  );

  return {
    data,
    error,
    isLoading,
    mutate,
  };
}

