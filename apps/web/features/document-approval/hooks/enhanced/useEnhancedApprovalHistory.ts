'use client';
import useSWR from 'swr';
import { buildApiUrl } from '@/lib/hooks/api-helpers';
import type { EnhancedApprovalHistoryResponse } from '@auto-rfp/core';

export const useEnhancedApprovalHistory = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
) => {
  const { data, error, mutate } = useSWR<EnhancedApprovalHistoryResponse>(
    buildApiUrl(`document-approval/enhanced-history?orgId=${orgId}&projectId=${projectId}&opportunityId=${opportunityId}&documentId=${documentId}`),
  );

  return {
    approvals: data?.items ?? [],
    count: data?.count ?? 0,
    activeApproval: data?.activeApproval ?? null,
    summary: data?.summary,
    userContext: data?.userContext,
    isLoading: !error && !data,
    error,
    refresh: mutate,
  };
};