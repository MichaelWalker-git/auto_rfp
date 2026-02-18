'use client';

import { useApi, buildApiUrl, ApiError } from './api-helpers';
import { GetApiKeyResponse } from '@auto-rfp/core';

export function useGetApiKey(orgId?: string) {
  const { data, isLoading, isError, error, mutate } = useApi<GetApiKeyResponse>(
    orgId ? ['samgov/api-key', orgId] : null,
    orgId ? buildApiUrl('samgov/get-api-key', { orgId }) : null,
  );

  return {
    apiKey: data?.apiKey || null,
    isLoading,
    isError,
    error: error as ApiError | undefined,
    mutate,
  };
}
