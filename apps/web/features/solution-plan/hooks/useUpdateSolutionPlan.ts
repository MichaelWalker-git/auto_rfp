'use client';

import useSWRMutation from 'swr/mutation';
import { apiMutate, buildApiUrl, type ApiError } from '@/lib/hooks/api-helpers';
import type { SolutionPlanResponse, SolutionPlanUpdateRequest } from '@auto-rfp/core';

/** The PATCH body minus the identifier triple the hook already holds. */
export type UpdateSolutionPlanArg = SolutionPlanUpdateRequest;

/**
 * PATCH /solution-plan/update — persist a manual edit of a READY plan's HTML.
 * The server bumps the monotonic version, marks the plan user-edited, and
 * clears staleness; anything not READY is refused with 409 (ADR-8).
 */
export const useUpdateSolutionPlan = (
  orgId: string | undefined,
  projectId: string | undefined,
  opportunityId: string | undefined,
) => {
  const url =
    orgId && projectId && opportunityId
      ? buildApiUrl('solution-plan/update', { orgId })
      : null;

  const { trigger, isMutating, error } = useSWRMutation<
    SolutionPlanResponse,
    ApiError,
    string | null,
    UpdateSolutionPlanArg
  >(url, (mutationUrl, { arg }) =>
    apiMutate<SolutionPlanResponse>(mutationUrl, 'PATCH', {
      orgId,
      projectId,
      opportunityId,
      htmlContent: arg.htmlContent,
    }),
  );

  return {
    updateSolutionPlan: trigger,
    isUpdating: isMutating,
    error,
  };
};
