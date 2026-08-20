'use client';

import useSWR from 'swr';
import { apiFetcher, buildApiUrl, type ApiError } from '@/lib/hooks/api-helpers';
import type { SolutionPlanItem, SolutionPlanResponse } from '@auto-rfp/core';
import { isSolutionPlanRunning } from '../lib/status';
import { retryUnlessNotFound } from '../lib/swr';

/** Poll cadence while a grilling run is in flight. */
export const SOLUTION_PLAN_POLL_INTERVAL_MS = 3_000;

/**
 * The Solution Plan record for an opportunity, polling every 3s while a run
 * is in flight (GRILLING / GENERATING_SOT). A 404 means "no plan yet" — it is
 * surfaced as `plan: null`, not an error, and is never retried.
 */
export const useSolutionPlan = (
  orgId: string | undefined,
  projectId: string | undefined,
  opportunityId: string | undefined,
) => {
  const url =
    orgId && projectId && opportunityId
      ? buildApiUrl('solution-plan/get', { orgId, projectId, opportunityId })
      : null;

  const { data, error, isLoading, mutate } = useSWR<SolutionPlanResponse, ApiError>(
    url,
    apiFetcher,
    {
      refreshInterval: (latest) =>
        isSolutionPlanRunning(latest?.plan) ? SOLUTION_PLAN_POLL_INTERVAL_MS : 0,
      revalidateOnFocus: false,
      onErrorRetry: retryUnlessNotFound,
    },
  );

  const notFound = error?.status === 404;
  const plan: SolutionPlanItem | null = data?.plan ?? null;

  return {
    plan,
    status: plan?.status ?? null,
    isRunning: isSolutionPlanRunning(plan),
    isLoading,
    /** True when the opportunity has no plan yet (start state). */
    notFound,
    error: notFound ? undefined : error,
    refresh: mutate,
  };
};
