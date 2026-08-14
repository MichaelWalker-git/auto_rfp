'use client';

import useSWR from 'swr';
import { apiFetcher, buildApiUrl, type ApiError } from '@/lib/hooks/api-helpers';
import type { GrillingMessageItem, SolutionPlanTranscriptResponse } from '@auto-rfp/core';
import { SOLUTION_PLAN_POLL_INTERVAL_MS } from './useSolutionPlan';
import { retryUnlessNotFound } from '../lib/swr';

/**
 * The grilling interview transcript for an opportunity's plan, polling every
 * 3s while the interview is running (GRILLING). Pass `enabled: false` to skip
 * fetching entirely (e.g. before a plan exists).
 */
export const useGrillingTranscript = (
  orgId: string | undefined,
  projectId: string | undefined,
  opportunityId: string | undefined,
  { enabled = true }: { enabled?: boolean } = {},
) => {
  const url =
    enabled && orgId && projectId && opportunityId
      ? buildApiUrl('solution-plan/transcript', { orgId, projectId, opportunityId })
      : null;

  const { data, error, isLoading, mutate } = useSWR<SolutionPlanTranscriptResponse, ApiError>(
    url,
    apiFetcher,
    {
      // Poll only while the interview itself is live; once synthesis starts
      // (GENERATING_SOT) the transcript is complete.
      refreshInterval: (latest) =>
        latest?.status === 'GRILLING' ? SOLUTION_PLAN_POLL_INTERVAL_MS : 0,
      revalidateOnFocus: false,
      onErrorRetry: retryUnlessNotFound,
    },
  );

  const messages: GrillingMessageItem[] = data?.messages ?? [];

  return {
    messages,
    status: data?.status ?? null,
    isLoading,
    error: error?.status === 404 ? undefined : error,
    refresh: mutate,
  };
};
