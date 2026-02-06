import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';

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
  const baseUrl = `${env.BASE_API_URL.replace(/\/$/, '')}/linear/get-api-key`;
  const url = orgId ? `${baseUrl}?orgId=${orgId}` : baseUrl;

  const { data, error, isLoading, mutate } = useSWR<GetApiKeyResponse>(
    orgId ? ['linear/api-key', orgId] : null,
    () => authFetcher(url).then(res => res.json()),
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    }
  );

  return {
    apiKey: data?.apiKey,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

export function useSetLinearApiKey(orgId?: string) {
  const baseUrl = `${env.BASE_API_URL}/linear/save-api-key`;
  const url = orgId ? `${baseUrl}?orgId=${orgId}` : baseUrl;

  const { trigger, isMutating, error, data } = useSWRMutation<SetApiKeyResponse, any, string, string>(
    url,
    async (url: string, { arg: apiKey }: { arg: string }) => {
      const response = await authFetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: 'Failed to save API key' }));
        throw new Error(error.message || 'Failed to save API key');
      }

      return response.json();
    }
  );

  return {
    setApiKey: trigger,
    isLoading: isMutating,
    isError: !!error,
    error,
    data,
  };
}

export function useValidateLinearApiKey() {
  const url = `${env.BASE_API_URL}/linear/validate-api-key`;

  const { trigger, isMutating, error, data } = useSWRMutation<ValidateApiKeyResponse, any, string, string>(
    url,
    async (url: string, { arg: apiKey }: { arg: string }) => {
      const response = await authFetcher(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });

      return response.json();
    }
  );

  return {
    validateApiKey: trigger,
    isValidating: isMutating,
    isError: !!error,
    error,
    data,
  };
}