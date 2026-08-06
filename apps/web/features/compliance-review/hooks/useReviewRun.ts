'use client';

import useSWR from 'swr';
import { apiFetcher, apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type {
  ComplianceFinding,
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

  const triggerReview = async () => {
    if (!orgId || !projectId || !oppId) return;
    const triggerUrl = buildApiUrl('compliance-review/run', {
      orgId,
      projectId,
      opportunityId: oppId,
    });
    await apiMutate<TriggerReviewResponse>(triggerUrl, 'POST');
    await mutate();
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
