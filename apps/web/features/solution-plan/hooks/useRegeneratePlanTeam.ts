'use client';

import useSWRMutation from 'swr/mutation';
import { apiMutate, buildApiUrl, type ApiError } from '@/lib/hooks/api-helpers';
import type { PlanTeamRegenerateResponse } from '@auto-rfp/core';

/**
 * POST /solution-plan/team/regenerate — the explicit team regenerate (W4):
 * a fresh recommendation replaces the current team, `userModified` resets.
 * `emptyPool: true` in the response is the prerequisite state (BR4.1); a 502
 * means matching failed and the existing team was left untouched (BR4.2).
 */
export const useRegeneratePlanTeam = (
  orgId: string | undefined,
  projectId: string | undefined,
  opportunityId: string | undefined,
) => {
  const url =
    orgId && projectId && opportunityId
      ? buildApiUrl('solution-plan/team/regenerate', { orgId })
      : null;

  const { trigger, isMutating, error } = useSWRMutation<
    PlanTeamRegenerateResponse,
    ApiError,
    string | null
  >(url, (mutationUrl) =>
    apiMutate<PlanTeamRegenerateResponse>(mutationUrl, 'POST', {
      orgId,
      projectId,
      opportunityId,
    }),
  );

  return {
    regeneratePlanTeam: trigger,
    isRegenerating: isMutating,
    error,
  };
};
