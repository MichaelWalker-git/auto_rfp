'use client';

import { useState } from 'react';
import useSWRMutation from 'swr/mutation';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { ApplyEditsRequest, ApplyEditsResponse, EditApplyResult } from '@auto-rfp/core';

/**
 * Apply confirmed edits from a proposal run. POSTs the selected editIds and
 * returns per-target results (applied | skipped-stale | failed). On success the
 * caller should refresh the affected document/form views so open editors reflect
 * the new values.
 */
export const useApplyEdits = (
  orgId: string | undefined,
  projectId: string | undefined,
  oppId: string | undefined,
) => {
  const ready = !!(orgId && projectId && oppId);
  const applyUrl = ready
    ? buildApiUrl('package-edit/apply', { orgId, projectId, opportunityId: oppId })
    : null;

  const [results, setResults] = useState<EditApplyResult[] | null>(null);

  const { trigger, isMutating: isApplying } = useSWRMutation<
    ApplyEditsResponse,
    Error,
    string | null,
    ApplyEditsRequest
  >(applyUrl, (url, { arg }) => apiMutate<ApplyEditsResponse>(url, 'POST', arg));

  const applyEdits = async (runId: string, editIds: string[]): Promise<EditApplyResult[] | null> => {
    if (!ready || editIds.length === 0) return null;
    const response = await trigger({ runId, editIds });
    setResults(response?.results ?? null);
    return response?.results ?? null;
  };

  return { applyEdits, isApplying, results, resetResults: () => setResults(null) };
};
