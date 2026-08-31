'use client';

import useSWR from 'swr';
import { apiFetcher, buildApiUrl, type ApiError } from '@/lib/hooks/api-helpers';
import type { SolutionPlanVersionContentResponse } from '@auto-rfp/core';
import { retryUnlessNotFound } from '../lib/swr';

/**
 * GET /solution-plan/version/content (contract C1) — one version's HTML body
 * plus its metadata, fetched only while the read-only view modal is open
 * (pass `versionId: null` when closed — lazy data, NFR2.15). A 404 means the
 * version vanished (deleted or pruned) and is surfaced as `notFound`, never
 * retried (W3).
 */
export const useVersionContent = (
  orgId: string | undefined,
  projectId: string | undefined,
  opportunityId: string | undefined,
  versionId: string | null,
) => {
  const url =
    orgId && projectId && opportunityId && versionId
      ? buildApiUrl('solution-plan/version/content', {
          orgId,
          projectId,
          opportunityId,
          versionId,
        })
      : null;

  const { data, error, isLoading, mutate } = useSWR<SolutionPlanVersionContentResponse, ApiError>(
    url,
    apiFetcher,
    { revalidateOnFocus: false, onErrorRetry: retryUnlessNotFound },
  );

  const notFound = error?.status === 404;

  return {
    content: data ?? null,
    isLoading,
    /** True when the version no longer exists (deleted or pruned). */
    notFound,
    error: notFound ? undefined : error,
    retry: mutate,
  };
};
