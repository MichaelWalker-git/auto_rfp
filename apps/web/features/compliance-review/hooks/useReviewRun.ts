'use client';

import { useRef } from 'react';
import useSWR from 'swr';
import { apiFetcher, apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type {
  ComplianceFinding,
  ComplianceReviewRun,
  GetReviewResponse,
  TriggerReviewResponse,
} from '@auto-rfp/core';

/**
 * Latest full-review run for an opportunity, with polling while RUNNING.
 * Exposes the run's findings, decisions, staleness flag, and a trigger.
 */
export const useReviewRun = (
  orgId: string | undefined,
  projectId: string | undefined,
  oppId: string | undefined,
) => {
  const url =
    orgId && projectId && oppId
      ? buildApiUrl('compliance-review/run', { orgId, projectId, opportunityId: oppId })
      : null;

  const { data, error, isLoading, mutate } = useSWR<GetReviewResponse>(url, apiFetcher, {
    // Poll only while a review is running; stop once terminal.
    refreshInterval: (latest) => (latest?.run?.status === 'RUNNING' ? 5_000 : 0),
    revalidateOnFocus: false,
  });

  const isRunning = data?.run?.status === 'RUNNING';

  // Re-entrancy guard: the POST + revalidation round-trip takes a moment, during
  // which `data.run` still holds the previous (terminal) run — so `isRunning`
  // hasn't flipped yet and the button stays enabled. Without this a fast second
  // click fires a duplicate POST (which then races into a 409).
  const isTriggeringRef = useRef(false);

  const triggerReview = async () => {
    if (!orgId || !projectId || !oppId) return;
    if (isTriggeringRef.current || isRunning) return;
    isTriggeringRef.current = true;

    const triggerUrl = buildApiUrl('compliance-review/run', {
      orgId,
      projectId,
      opportunityId: oppId,
    });

    // Build a RUNNING run for the cache. Only `status`/`findings` drive the UI;
    // the rest is filled from the current run (or synthesized) and is replaced
    // by the authoritative run on the next revalidation.
    const runningRun = (current: GetReviewResponse | undefined, reviewId: string): ComplianceReviewRun => ({
      reviewId,
      orgId,
      projectId,
      oppId,
      status: 'RUNNING',
      trigger: 'FULL',
      startedAt: current?.run?.startedAt ?? new Date().toISOString(),
      snapshotVersionIds: {},
      findings: [],
    });

    try {
      // Optimistically flip the cached run to RUNNING so the UI reflects the
      // re-run immediately (button disabled, "Reviewing…" state) instead of
      // waiting for the POST + GET revalidation to land.
      await mutate(
        async (current) => {
          const trigger = await apiMutate<TriggerReviewResponse>(triggerUrl, 'POST');
          return {
            run: { ...runningRun(current, trigger.reviewId), status: trigger.status },
            decisions: current?.decisions ?? [],
            stale: false,
          };
        },
        {
          optimisticData: (current) => ({
            // Placeholder reviewId only until the POST returns the real one; use a
            // real UUID (not a 'pending' sentinel) so the cached run satisfies
            // ComplianceReviewRunSchema's .uuid() contract if ever re-validated.
            run: runningRun(current, current?.run?.reviewId ?? crypto.randomUUID()),
            decisions: current?.decisions ?? [],
            stale: false,
          }),
          rollbackOnError: true,
          revalidate: true,
        },
      );
    } finally {
      isTriggeringRef.current = false;
    }
  };

  const findings: ComplianceFinding[] = data?.run?.findings ?? [];

  return {
    run: data?.run ?? null,
    findings,
    decisions: data?.decisions ?? [],
    stale: data?.stale ?? false,
    status: data?.run?.status ?? null,
    isRunning,
    isLoading,
    error,
    triggerReview,
    refresh: mutate,
  };
};
