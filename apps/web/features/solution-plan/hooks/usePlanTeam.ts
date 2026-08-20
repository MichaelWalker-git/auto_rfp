'use client';

import useSWR from 'swr';
import { apiFetcher, buildApiUrl, type ApiError } from '@/lib/hooks/api-helpers';
import type { PlanTeam, PlanTeamResponse } from '@auto-rfp/core';
import { retryUnlessNotFound } from '../lib/swr';

/** SWR key for the plan team — shared with the save/regenerate mutation hooks. */
export const planTeamKey = (
  orgId: string | undefined,
  projectId: string | undefined,
  opportunityId: string | undefined,
): string | null =>
  orgId && projectId && opportunityId
    ? buildApiUrl('solution-plan/team', { orgId, projectId, opportunityId })
    : null;

/**
 * GET /solution-plan/team — the plan's team with `removedEmployee` derived
 * against the live pool on every read (BR3.3). `team: null` means no team
 * yet (pre-synthesis, or the empty-pool prerequisite state). A 404 means the
 * plan itself doesn't exist — surfaced as `notFound`, never retried.
 */
export const usePlanTeam = (
  orgId: string | undefined,
  projectId: string | undefined,
  opportunityId: string | undefined,
  options?: { enabled?: boolean },
) => {
  const url = options?.enabled === false ? null : planTeamKey(orgId, projectId, opportunityId);

  const { data, error, isLoading, mutate } = useSWR<PlanTeamResponse, ApiError>(url, apiFetcher, {
    revalidateOnFocus: false,
    onErrorRetry: retryUnlessNotFound,
  });

  const notFound = error?.status === 404;
  const team: PlanTeam | null = data?.team ?? null;

  return {
    team,
    isLoading,
    /** True when the opportunity has no solution plan at all. */
    notFound,
    error: notFound ? undefined : error,
    refresh: mutate,
  };
};
