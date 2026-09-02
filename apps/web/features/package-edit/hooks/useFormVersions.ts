'use client';

import useSWR from 'swr';
import { apiFetcher, apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { DetectedFormField, RequiredFormItem, RequiredFormVersionListResponse } from '@auto-rfp/core';

/**
 * Version history for a required form + a revert action. Backed by the
 * required-forms versions/revert endpoints (form history parity with documents).
 */
export const useFormVersions = (
  orgId: string | undefined,
  projectId: string | undefined,
  oppId: string | undefined,
  formId: string | undefined,
) => {
  const ready = !!(orgId && projectId && oppId && formId);
  const listUrl = ready
    ? buildApiUrl('required-forms/versions', {
        orgId,
        projectId,
        opportunityId: oppId,
        formId,
      })
    : null;

  const { data, isLoading, error, mutate } = useSWR<RequiredFormVersionListResponse>(
    listUrl,
    apiFetcher,
    { revalidateOnFocus: false },
  );

  // Current form fields — the baseline a version is diffed against for the
  // "what would restoring change?" preview. Its loading/error state is surfaced
  // separately: diffing against an unloaded (empty) baseline would render every
  // field as "added" and misstate a destructive restore, so the UI must gate the
  // preview on this.
  // Param order must match the form editor page's `required-forms/get` key
  // exactly ({ projectId, opportunityId, formId, orgId }) — buildApiUrl emits
  // query params in insertion order, so a different order yields a different SWR
  // cache key. Keeping them identical means the page's mutateForm() (fired via
  // onFieldUpdated after edits/revert) also revalidates this hook's baseline.
  const formUrl = ready
    ? buildApiUrl('required-forms/get', { projectId, opportunityId: oppId, formId, orgId })
    : null;
  const {
    data: formData,
    isLoading: isLoadingForm,
    error: formError,
    mutate: mutateForm,
  } = useSWR<{ form: RequiredFormItem }>(formUrl, apiFetcher, {
    revalidateOnFocus: false,
  });
  const currentFields: DetectedFormField[] = formData?.form?.fields ?? [];
  // Have we actually loaded the current form? `formData` present means the diff
  // baseline is real (not the []-while-loading placeholder).
  const hasCurrentFields = !!formData?.form;

  const revert = async (targetVersion: number): Promise<void> => {
    if (!ready) return;
    const revertUrl = buildApiUrl('required-forms/revert-version', { orgId });
    await apiMutate(revertUrl, 'POST', {
      formId,
      projectId,
      opportunityId: oppId,
      targetVersion,
    });
    // Revalidate both the version list AND the current-form baseline: after a
    // revert the form now equals the restored version, so the diff shown when
    // previewing other versions must be recomputed against the new baseline.
    await Promise.all([mutate(), mutateForm()]);
  };

  return {
    versions: data?.versions ?? [],
    count: data?.count ?? 0,
    currentFields,
    hasCurrentFields,
    isLoadingForm,
    formError,
    isLoading,
    error,
    revert,
    refresh: mutate,
  };
};
