'use client';
import useSWR from 'swr';
import { apiFetcher, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { SubmissionReadinessResponse } from '@auto-rfp/core';

export const useSubmissionReadiness = (
  orgId: string | undefined,
  projectId: string | undefined,
  oppId: string | undefined,
) => {
  const url =
    orgId && projectId && oppId
      ? buildApiUrl('proposal-submission/readiness', { orgId, projectId, oppId })
      : null;

  const { data, error, isLoading, mutate } = useSWR<SubmissionReadinessResponse>(
    url,
    apiFetcher,
    { refreshInterval: 15_000 }, // auto-refresh while AI is generating
  );

  return {
    readiness: data ?? null,
    isReady: data?.ready ?? false,
    checks: data?.checks ?? [],
    blockingFails: data?.blockingFails ?? 0,
    warningFails: data?.warningFails ?? 0,
    isLoading,
    error,
    refresh: mutate,
  };
};
