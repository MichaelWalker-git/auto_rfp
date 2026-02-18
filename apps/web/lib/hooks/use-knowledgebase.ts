'use client';

import useSWRMutation from 'swr/mutation';
import { useApi, apiMutate, buildApiUrl, ApiError } from './api-helpers';
import { breadcrumbs } from '@/lib/sentry';
import { KnowledgeBase, KnowledgeBaseItem } from '@auto-rfp/core';

// ─── GET Hooks ───

export function useKnowledgeBases(orgId: string | null) {
  return useApi<KnowledgeBase[]>(
    orgId ? ['knowledgebases', orgId] : null,
    orgId ? buildApiUrl('knowledgebase/get-knowledgebases', { orgId }) : null,
  );
}

export function useKnowledgeBase(kbId: string | null, orgId: string | null) {
  return useApi<KnowledgeBase>(
    kbId && orgId ? ['knowledgebase', orgId, kbId] : null,
    kbId && orgId ? buildApiUrl('knowledgebase/get-knowledgebase', { orgId, kbId }) : null,
  );
}

// ─── Mutation Hooks ───

export function useCreateKnowledgeBase(orgId: string) {
  return useSWRMutation<KnowledgeBase, ApiError, string, Partial<KnowledgeBase>>(
    buildApiUrl('knowledgebase/create-knowledgebase', { orgId }),
    async (url, { arg }) => {
      const kb = await apiMutate<KnowledgeBase>(url, 'POST', arg);
      breadcrumbs.knowledgeBaseCreated(kb.id, kb.name);
      return kb;
    },
  );
}

export function useDeleteKnowledgeBase() {
  return useSWRMutation<unknown, ApiError, string, KnowledgeBase>(
    buildApiUrl('knowledgebase/delete-knowledgebase'),
    async (url, { arg }) => {
      const result = await apiMutate(url, 'DELETE', arg);
      breadcrumbs.knowledgeBaseDeleted(arg.id);
      return result;
    },
  );
}

export function useEditKnowledgeBase() {
  return useSWRMutation<KnowledgeBase, ApiError, string, KnowledgeBaseItem & { kbId: string; orgId: string }>(
    buildApiUrl('knowledgebase/edit-knowledgebase'),
    async (_url, { arg }) => {
      const url = buildApiUrl('knowledgebase/edit-knowledgebase', { orgId: arg.orgId, kbId: arg.kbId });
      return apiMutate<KnowledgeBase>(url, 'PATCH', arg);
    },
  );
}
