'use client';

import useSWR from 'swr';
import { apiFetcher, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { GetPackageEditRunResponse } from '@auto-rfp/core';

/**
 * A cross-package edit proposal run, with polling while PROPOSING (the async
 * worker is scanning). Exposes the run's proposals, status, and a staleness flag.
 * Mirrors useReviewRun.
 *
 * Pass `runId` to poll a SPECIFIC run rather than the opportunity's latest — the
 * unified chat does this so an inline run view (bound to one message) can't
 * display a run started from another surface that happens to be latest (W2).
 */
export const usePackageEditRun = (
  orgId: string | undefined,
  projectId: string | undefined,
  oppId: string | undefined,
  runId?: string,
) => {
  const url =
    orgId && projectId && oppId
      ? buildApiUrl('package-edit/run', {
          orgId,
          projectId,
          opportunityId: oppId,
          ...(runId ? { runId } : {}),
        })
      : null;

  const { data, error, isLoading, mutate } = useSWR<GetPackageEditRunResponse>(url, apiFetcher, {
    // Poll only while the worker is drafting proposals; stop once terminal.
    refreshInterval: (latest) => (latest?.run?.status === 'PROPOSING' ? 5_000 : 0),
    revalidateOnFocus: false,
  });

  const isProposing = data?.run?.status === 'PROPOSING';

  return {
    run: data?.run ?? null,
    proposals: data?.run?.proposals ?? [],
    status: data?.run?.status ?? null,
    stale: data?.stale ?? false,
    isProposing,
    isLoading,
    error,
    refresh: mutate,
  };
};
