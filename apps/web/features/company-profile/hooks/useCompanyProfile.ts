'use client';

import { useApi, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { CompanyProfileResponse } from '@auto-rfp/core';

export const useCompanyProfile = (orgId: string | undefined) => {
  const url = orgId ? buildApiUrl('/company-profile/get', { orgId }) : null;
  const { data, error, isLoading, mutate } = useApi<CompanyProfileResponse>(url, url);

  return {
    profile: data?.profile ?? null,
    error,
    isLoading,
    mutate,
  };
};
