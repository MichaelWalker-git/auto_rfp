'use client';

import useSWRMutation from 'swr/mutation';
import { apiMutate, buildApiUrl, type ApiError } from '@/lib/hooks/api-helpers';
import type { PlanTeamMember, PlanTeamResponse } from '@auto-rfp/core';

/**
 * PATCH /solution-plan/team/save — persist a human-edited team (BR3.1). The
 * server reconciles every line against the live pool, sets `userModified` +
 * `savedAt`, and bumps the plan version; the saved team survives plan
 * regenerations (BR1.2).
 */
export const useSavePlanTeam = (
  orgId: string | undefined,
  projectId: string | undefined,
  opportunityId: string | undefined,
) => {
  const url =
    orgId && projectId && opportunityId ? buildApiUrl('solution-plan/team/save', { orgId }) : null;

  const { trigger, isMutating, error } = useSWRMutation<
    PlanTeamResponse,
    ApiError,
    string | null,
    { members: PlanTeamMember[] }
  >(url, (mutationUrl, { arg }) =>
    apiMutate<PlanTeamResponse>(mutationUrl, 'PATCH', {
      orgId,
      projectId,
      opportunityId,
      members: arg.members,
    }),
  );

  return {
    savePlanTeam: trigger,
    isSaving: isMutating,
    error,
  };
};
