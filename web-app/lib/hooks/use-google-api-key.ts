'use client';

import useSWRMutation from 'swr/mutation';
import { useApi, apiMutate, buildApiUrl, ApiError } from './api-helpers';
import { GetApiKeyResponse, SetApiKeyResponse } from '@auto-rfp/shared';

export function useGetGoogleApiKey(orgId?: string) {
  const { data, isLoading, isError, error, mutate } = useApi<GetApiKeyResponse>(
    orgId ? ['google/api-key', orgId] : null,
    orgId ? buildApiUrl('google/get-api-key', { orgId }) : null,
  );

  return {
    apiKey: data?.apiKey || null,
    isLoading,
    isError,
    error: error as ApiError | undefined,
    mutate,
  };
}

export function useSetGoogleApiKey(orgId?: string) {
  const url = buildApiUrl('google/set-api-key', { orgId });

  const { trigger, data, error, isMutating } = useSWRMutation<
    SetApiKeyResponse,
    ApiError,
    string,
    string
  >(url, async (url, { arg: apiKey }) => apiMutate<SetApiKeyResponse>(url, 'POST', { apiKey }));

  return {
    setApiKey: trigger,
    isLoading: isMutating,
    isError: !!error,
    error,
    data,
  };
}
