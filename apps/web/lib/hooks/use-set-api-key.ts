'use client';

import useSWRMutation from 'swr/mutation';
import { apiMutate, buildApiUrl, ApiError } from './api-helpers';
import { SetApiKeyResponse } from '@auto-rfp/core';

export function useSetApiKey(orgId?: string) {
  const url = buildApiUrl('samgov/set-api-key', { orgId });

  const { trigger, isMutating, error, data } = useSWRMutation<
    SetApiKeyResponse,
    ApiError,
    string,
    { apiKey: string }
  >(url, async (url, { arg }) => apiMutate<SetApiKeyResponse>(url, 'POST', arg));

  const setApiKey = async (apiKey: string): Promise<SetApiKeyResponse> => {
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
