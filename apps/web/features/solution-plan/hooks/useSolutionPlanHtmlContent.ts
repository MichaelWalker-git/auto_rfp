'use client';

import useSWR from 'swr';
import { apiFetcher, buildApiUrl, type ApiError } from '@/lib/hooks/api-helpers';
import type { SolutionPlanHtmlContentResponse } from '@auto-rfp/core';
import { retryUnlessNotFound } from '../lib/swr';

/**
 * The synthesized (or user-edited) HTML body of the plan from S3, via
 * GET /solution-plan/html-content. Only fetch when the plan is READY —
 * pass `enabled: plan?.status === 'READY'`; while a run is in flight the
 * endpoint has no content to return.
 */
export const useSolutionPlanHtmlContent = (
  orgId: string | undefined,
  projectId: string | undefined,
  opportunityId: string | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) => {
  const url =
    enabled && orgId && projectId && opportunityId
      ? buildApiUrl('solution-plan/html-content', { orgId, projectId, opportunityId })
      : null;

  const { data, error, isLoading, mutate } = useSWR<SolutionPlanHtmlContentResponse, ApiError>(
    url,
    apiFetcher,
    {
      revalidateOnFocus: false,
      onErrorRetry: retryUnlessNotFound,
    },
  );

  const notFound = error?.status === 404;

  return {
    content: data ?? null,
    isLoading,
    /** True when the plan (or its content) does not exist yet. */
    notFound,
    error: notFound ? undefined : error,
    refresh: mutate,
  };
};
