'use client';

import useSWRMutation from 'swr/mutation';
import { apiMutate, buildApiUrl, ApiError } from './api-helpers';
import { ApiKeyResponse } from '@auto-rfp/core';

export function useSetApiKey(orgId?: string, source: 'SAM_GOV' | 'DIBBS' = 'SAM_GOV') {
  const url = buildApiUrl('search-opportunities/api-key');

  const { trigger, isMutating, error, data } = useSWRMutation<
    ApiKeyResponse,
    ApiError,
    string,
    { apiKey: string }
  >(url, async (url, { arg }) =>
    apiMutate<ApiKeyResponse>(url, 'POST', { source, orgId, ...arg }),
  );

  const setApiKey = async (apiKey: string): Promise<ApiKeyResponse> => {
    return trigger({ apiKey });
  };

  return {
    setApiKey,
    isLoading: isMutating,
    isError: !!error,
    error,
    data,
  };
}
