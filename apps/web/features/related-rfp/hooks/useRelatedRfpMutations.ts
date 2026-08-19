'use client';

import { useCallback } from 'react';
import { useSWRConfig } from 'swr';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { RelatedRfpCreateRequest, RelatedRfpItem } from '@auto-rfp/core';

interface Scope {
  orgId: string;
  projectId: string;
  oppId: string;
}

/**
 * Mutations for related-RFP links (HOR-2610): manual add, remove, and manual
 * refresh (re-run auto-discovery). Each revalidates the related-RFP list.
 */
export const useRelatedRfpMutations = ({ orgId, projectId, oppId }: Scope) => {
  const { mutate } = useSWRConfig();

  const revalidate = useCallback(() => {
    mutate(
      (key: unknown) =>
        typeof key === 'string' &&
        (key.includes('/related-rfps/list') || key.includes('/related-rfps/agency-history')),
    );
  }, [mutate]);

  const addRelated = useCallback(
    async (input: Omit<RelatedRfpCreateRequest, 'orgId' | 'projectId' | 'oppId' | 'origin'>) => {
      const url = buildApiUrl('/related-rfps/create');
      const result = await apiMutate<{ item: RelatedRfpItem }, RelatedRfpCreateRequest>(url, 'POST', {
        orgId,
        projectId,
        oppId,
        origin: 'MANUAL',
        ...input,
      });
      revalidate();
      return result.item;
    },
    [orgId, projectId, oppId, revalidate],
  );

  const removeRelated = useCallback(
    async (relatedOppKey: string) => {
      const url = buildApiUrl(`/related-rfps/${encodeURIComponent(relatedOppKey)}`, {
        orgId,
        projectId,
        oppId,
      });
      await apiMutate<{ message: string }>(url, 'DELETE');
      revalidate();
    },
    [orgId, projectId, oppId, revalidate],
  );

  const refreshRelated = useCallback(async () => {
    const url = buildApiUrl('/related-rfps/refresh');
    await apiMutate<{ message: string }, Scope>(url, 'POST', { orgId, projectId, oppId });
    // Discovery is async; the caller should poll/refetch shortly after.
    revalidate();
  }, [orgId, projectId, oppId, revalidate]);

  return { addRelated, removeRelated, refreshRelated };
};
