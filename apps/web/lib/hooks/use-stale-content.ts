'use client';

import useSWRMutation from 'swr/mutation';
import { useApi, apiMutate, buildApiUrl, ApiError } from './api-helpers';
import type {
  StaleContentReportResponse,
  ReactivateContentItemDTO,
  BulkReviewDTO,
} from '@auto-rfp/core';

// Re-export types for consumers
export type { StaleContentReportResponse, ReactivateContentItemDTO, BulkReviewDTO } from '@auto-rfp/core';

// ─── GET Hook ───

export function useStaleContentReport(orgId: string | null, kbId: string | null) {
  const { data, isLoading, isError, error, mutate } = useApi<StaleContentReportResponse>(
    orgId && kbId ? ['stale-content-report', orgId, kbId] : null,
    orgId && kbId
      ? buildApiUrl('content-library/stale-report', { orgId, kbId })
      : null,
    { dedupingInterval: 60_000 },
  );

  return {
    report: data ?? null,
    summary: data?.summary ?? null,
    staleItems: data?.staleItems ?? [],
    warningItems: data?.warningItems ?? [],
    lastScanAt: data?.lastScanAt ?? null,
    isLoading,
    isError,
    error,
    mutate,
  };
}

// ─── Mutation Hooks ───

export function useReactivateContentItem(orgId: string, kbId: string) {
  const reactivate = async (itemId: string, dto?: ReactivateContentItemDTO) => {
    const url = buildApiUrl(`content-library/reactivate/${itemId}`, { orgId, kbId });
    return apiMutate<{ message: string; itemId: string; freshnessStatus: string }>(
      url,
      'POST',
      dto ?? {},
    );
  };

  return { reactivate };
}

export function useBulkReviewContent(orgId: string, kbId: string) {
  const url = buildApiUrl('content-library/bulk-review', { orgId, kbId });

  const { trigger, isMutating, error } = useSWRMutation<
    { message: string; action: string; results: Array<{ itemId: string; success: boolean; error?: string }> },
    ApiError,
    string,
    BulkReviewDTO
  >(url, async (url, { arg }) =>
    apiMutate<{ message: string; action: string; results: Array<{ itemId: string; success: boolean; error?: string }> }>(
      url,
      'POST',
      arg,
    ),
  );

  return {
    bulkReview: trigger,
    isBulkReviewing: isMutating,
    error,
  };
}
