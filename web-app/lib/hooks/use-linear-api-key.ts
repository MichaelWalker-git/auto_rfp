'use client';

import useSWRMutation from 'swr/mutation';
import { useApi, apiMutate, buildApiUrl, ApiError } from './api-helpers';

interface GetApiKeyResponse {
  apiKey: string;
  orgId: string;
  message: string;
}

interface SetApiKeyResponse {
  success: boolean;
  message: string;
}

interface ValidateApiKeyResponse {
  valid: boolean;
  message: string;
  user?: {
    id: string;
    name: string;
    email: string;
  };
}

export function useGetLinearApiKey(orgId?: string) {
  const { data, isLoading, isError, error, mutate } = useApi<GetApiKeyResponse>(
    orgId ? ['linear/api-key', orgId] : null,
    orgId ? buildApiUrl('linear/get-api-key', { orgId }) : null,
    { shouldRetryOnError: false },
  );

  return {
    apiKey: data?.apiKey,
    isLoading,
    isError,
    error,
    mutate,
  };
}

export function useSetLinearApiKey(orgId?: string) {
  const url = buildApiUrl('linear/save-api-key', { orgId });

  const { trigger, isMutating, error, data } = useSWRMutation<
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

export function useValidateLinearApiKey() {
  const url = buildApiUrl('linear/validate-api-key');

  const { trigger, isMutating, error, data } = useSWRMutation<
    ValidateApiKeyResponse,
    ApiError,
    string,
    string
  >(url, async (url, { arg: apiKey }) => apiMutate<ValidateApiKeyResponse>(url, 'POST', { apiKey }));

  return {
    validateApiKey: trigger,
    isValidating: isMutating,
    isError: !!error,
    error,
    data,
  };
}
