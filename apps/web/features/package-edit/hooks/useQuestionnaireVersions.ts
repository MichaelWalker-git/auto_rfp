'use client';

import useSWR from 'swr';
import { apiFetcher, apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { QuestionnaireVersionListResponse } from '@auto-rfp/core';

/**
 * Version history for a file-based XLSX questionnaire + a revert action. Backed
 * by the questionnaire versions/revert endpoints (parity with document + form
 * history). Unlike forms, a questionnaire snapshot is the whole .xlsx file, so
 * there is no cheap per-field diff preview — the list shows version metadata and
 * restore replaces the live file wholesale.
 */
export const useQuestionnaireVersions = (
  orgId: string | undefined,
  projectId: string | undefined,
  oppId: string | undefined,
  documentId: string | undefined,
) => {
  const ready = !!(orgId && projectId && oppId && documentId);
  const listUrl = ready
    ? buildApiUrl('questionnaire/versions', {
        orgId,
        projectId,
        opportunityId: oppId,
        documentId,
      })
    : null;

  const { data, isLoading, error, mutate } = useSWR<QuestionnaireVersionListResponse>(
    listUrl,
    apiFetcher,
    { revalidateOnFocus: false },
  );

  const revert = async (targetVersion: number): Promise<void> => {
    if (!ready) return;
    const revertUrl = buildApiUrl('questionnaire/revert-version', { orgId });
    await apiMutate(revertUrl, 'POST', {
      documentId,
      projectId,
      opportunityId: oppId,
      targetVersion,
    });
    await mutate();
  };

  return {
    versions: data?.versions ?? [],
    count: data?.count ?? 0,
    isLoading,
    error,
    revert,
    refresh: mutate,
  };
};
