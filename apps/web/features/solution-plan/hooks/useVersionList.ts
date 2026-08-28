'use client';

import { useEffect, useRef } from 'react';
import useSWR from 'swr';
import { apiFetcher, buildApiUrl, type ApiError } from '@/lib/hooks/api-helpers';
import type { SolutionPlanVersionListItem, SolutionPlanVersionListResponse } from '@auto-rfp/core';

/** SWR key for the version list — shared with the label/delete/restore mutation hooks. */
export const versionListKey = (
  orgId: string | undefined,
  projectId: string | undefined,
  opportunityId: string | undefined,
): string | null =>
  orgId && projectId && opportunityId
    ? buildApiUrl('solution-plan/versions', { orgId, projectId, opportunityId })
    : null;

/**
 * GET /solution-plan/versions (contract C1) — the plan's history, newest
 * first (≤30), plus `currentVersionId` (the NEWEST history record — the UI
 * never derives "current" from the plan's internal counter).
 *
 * W7 refresh: no polling of its own. Pass the page's already-polled
 * `isPlanRunning`; when it flips to false (generation finished) the list
 * revalidates so the new "generation" version appears without user action.
 */
export const useVersionList = (
  orgId: string | undefined,
  projectId: string | undefined,
  opportunityId: string | undefined,
  { isPlanRunning = false }: { isPlanRunning?: boolean } = {},
) => {
  const url = versionListKey(orgId, projectId, opportunityId);

  const { data, error, isLoading, mutate } = useSWR<SolutionPlanVersionListResponse, ApiError>(
    url,
    apiFetcher,
    { revalidateOnFocus: false },
  );

  // Piggyback the page's plan polling (NFR2.16): running → not-running means
  // the run finished and a new version may exist.
  const wasRunning = useRef(isPlanRunning);
  useEffect(() => {
    if (wasRunning.current && !isPlanRunning) void mutate();
    wasRunning.current = isPlanRunning;
  }, [isPlanRunning, mutate]);

  const versions: SolutionPlanVersionListItem[] = data?.versions ?? [];

  return {
    versions,
    currentVersionId: data?.currentVersionId ?? null,
    isLoading,
    error,
    refresh: mutate,
  };
};
