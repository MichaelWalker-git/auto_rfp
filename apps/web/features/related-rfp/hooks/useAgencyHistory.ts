'use client';

import { useApi, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { AgencyHistoryResponse } from '@auto-rfp/core';

interface UseAgencyHistoryArgs {
  orgId: string;
  projectId: string;
  oppId: string;
  /** Free-text query for the picker. Empty string lists recent agency history. */
  q?: string;
  /** Only fetch when the picker is open. */
  enabled?: boolean;
}

/**
 * Searches the issuing agency's RFP history on HigherGov for the manual-add
 * picker (HOR-2610). Each result is flagged `alreadyRelated` when it is already
 * linked to the current opportunity.
 */
export const useAgencyHistory = ({ orgId, projectId, oppId, q, enabled = true }: UseAgencyHistoryArgs) => {
  const ready = Boolean(enabled && orgId && projectId && oppId);
  const url = ready
    ? buildApiUrl('/related-rfps/agency-history', { orgId, projectId, oppId, q: q || undefined })
    : null;

  const { data, isLoading, isError, error, mutate } = useApi<AgencyHistoryResponse>(url, url);

  return {
    items: data?.items ?? [],
    isLoading,
    isError,
    error,
    mutate,
  };
};
