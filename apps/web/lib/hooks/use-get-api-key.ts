'use client';

import { useApi, buildApiUrl, ApiError } from './api-helpers';
import { GetApiKeyResponse } from '@auto-rfp/core';

export function useGetApiKey(orgId?: string) {
  const { data, isLoading, isError, error, mutate } = useApi<GetApiKeyResponse>(
    orgId ? ['search-opportunities/api-key', orgId] : null,
    orgId ? buildApiUrl('search-opportunities/api-key', { orgId, source: 'SAM_GOV' }) : null,
  );

  return {
    apiKey: data?.apiKey || null,
    isLoading,
    isError,
    error: error as ApiError | undefined,
    mutate,
  };
}
