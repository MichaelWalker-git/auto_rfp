'use client';
import useSWR from 'swr';
import { apiFetcher, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { ComplianceReportResponse } from '@auto-rfp/core';

export const useComplianceReport = (
  orgId: string | undefined,
  projectId: string | undefined,
  oppId: string | undefined,
) => {
  const url =
    orgId && projectId && oppId
      ? buildApiUrl('proposal-submission/compliance', { orgId, projectId, oppId })
      : null;

  const { data, error, isLoading, mutate } = useSWR<ComplianceReportResponse>(
    url,
    apiFetcher,
    { refreshInterval: 30_000 }, // auto-refresh every 30s
  );

  return {
    report: data ?? null,
    isReady: data?.ready ?? false,
    categories: data?.categories ?? [],
    checks: data?.checks ?? [],
    blockingFails: data?.blockingFails ?? 0,
    warningFails: data?.warningFails ?? 0,
    totalChecks: data?.totalChecks ?? 0,
    passRate: data?.passRate ?? 0,
    isLoading,
    error,
    refresh: mutate,
  };
};
