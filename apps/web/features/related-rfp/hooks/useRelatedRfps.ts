'use client';

import { useApi } from '@/lib/hooks/api-helpers';
import { buildApiUrl } from '@/lib/hooks/api-helpers';
import type { RelatedRfpsResponse } from '@auto-rfp/core';

interface UseRelatedRfpsArgs {
  orgId: string;
  projectId: string;
  oppId: string;
}

/**
 * Lists the related-RFP links for an opportunity (HOR-2610). Returns both AUTO
 * (discovered) and MANUAL (user-added) links, AUTO-first and score-ordered by
 * the backend.
 */
export const useRelatedRfps = ({ orgId, projectId, oppId }: UseRelatedRfpsArgs) => {
  const ready = Boolean(orgId && projectId && oppId);
  const url = ready
    ? buildApiUrl('/related-rfps/list', { orgId, projectId, oppId })
    : null;

  const { data, isLoading, isError, error, mutate } = useApi<RelatedRfpsResponse>(url, url);

  return {
    items: data?.items ?? [],
    isLoading,
    isError,
    error,
    mutate,
  };
};
