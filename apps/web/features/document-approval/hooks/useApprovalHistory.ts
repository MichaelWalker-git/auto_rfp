'use client';
import useSWR from 'swr';
import { apiFetcher, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { DocumentApprovalHistoryResponse } from '@auto-rfp/core';

export const useApprovalHistory = (
  orgId: string | undefined,
  projectId: string | undefined,
  opportunityId: string | undefined,
  documentId: string | undefined,
) => {
  const url =
    orgId && projectId && opportunityId && documentId
      ? buildApiUrl('document-approval/history', { orgId, projectId, opportunityId, documentId })
      : null;

  const { data, error, isLoading, mutate } = useSWR<DocumentApprovalHistoryResponse>(
    url,
    apiFetcher,
    { revalidateOnFocus: false },
  );

  return {
    approvals: data?.items ?? [],
    count: data?.count ?? 0,
    activeApproval: data?.activeApproval ?? null,
    hasPendingApproval: !!(data?.activeApproval),
    isLoading,
    error,
    refresh: mutate,
  };
};
