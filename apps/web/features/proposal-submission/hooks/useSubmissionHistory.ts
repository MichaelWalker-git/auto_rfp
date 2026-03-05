'use client';
import useSWR from 'swr';
import { apiFetcher, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { ProposalSubmissionHistoryResponse } from '@auto-rfp/core';

export const useSubmissionHistory = (
  orgId: string | undefined,
  projectId: string | undefined,
  oppId: string | undefined,
) => {
  const url =
    orgId && projectId && oppId
      ? buildApiUrl('proposal-submission/history', { orgId, projectId, oppId })
      : null;

  const { data, error, isLoading, mutate } = useSWR<ProposalSubmissionHistoryResponse>(
    url,
    apiFetcher,
    { revalidateOnFocus: false },
  );

  return {
    submissions: data?.items ?? [],
    count: data?.count ?? 0,
    isLoading,
    error,
    refresh: mutate,
  };
};
