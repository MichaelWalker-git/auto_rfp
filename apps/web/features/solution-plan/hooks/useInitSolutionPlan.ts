'use client';

import useSWRMutation from 'swr/mutation';
import { apiMutate, buildApiUrl, type ApiError } from '@/lib/hooks/api-helpers';
import type { SolutionPlanInitRequest, SolutionPlanInitResponse } from '@auto-rfp/core';

/**
 * The non-identifier part of the init request. `restart: true` abandons a run
 * that is mid-flight (GRILLING / GENERATING_SOT) and starts over; without it
 * a mid-flight re-init is refused with 409 (ADR-5).
 */
export type InitSolutionPlanArg = Pick<SolutionPlanInitRequest, 'restart'>;

/**
 * POST /solution-plan/init — start (or regenerate) the grilling run.
 * The same call covers Start, Regenerate, and Retry; the server wipes the
 * previous run's transcript and issues a fresh runId.
 */
export const useInitSolutionPlan = (
  orgId: string | undefined,
  projectId: string | undefined,
  opportunityId: string | undefined,
) => {
  const url =
    orgId && projectId && opportunityId
      ? buildApiUrl('solution-plan/init', { orgId })
      : null;

  const { trigger, isMutating, error } = useSWRMutation<
    SolutionPlanInitResponse,
    ApiError,
    string | null,
    InitSolutionPlanArg | undefined
  >(url, (mutationUrl, { arg }) =>
    apiMutate<SolutionPlanInitResponse>(mutationUrl, 'POST', {
      orgId,
      projectId,
      opportunityId,
      ...(arg?.restart !== undefined ? { restart: arg.restart } : {}),
    }),
  );

  return {
    initSolutionPlan: trigger,
    isInitializing: isMutating,
    error,
  };
};
