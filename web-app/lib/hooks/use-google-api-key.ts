'use client';

import { env } from '@/lib/env';
import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';

interface GetApiKeyResponse {
  message: string;
  apiKey: string;
  orgId: string;
}

interface SetApiKeyResponse {
  message: string;
  orgId: string;
}

class HttpError extends Error {
  status?: number;
  details?: any;
}

const defineFetcher = async (url: string): Promise<GetApiKeyResponse> => {
  const res = await authFetcher(url);

  if (!res.ok) {
    const err = new HttpError('Failed to retrieve Google API key.');
    err.status = res.status;
    try {
      err.details = await res.json();
    } catch {
      // ignore
    }
    throw err;
  }

  const text = await res.text();
  return (text ? JSON.parse(text) : null) as GetApiKeyResponse;
};

export function useGetGoogleApiKey(orgId?: string) {
  const baseUrl = `${env.BASE_API_URL.replace(/\/$/, '')}/google/get-api-key`;
  const url = orgId ? `${baseUrl}?orgId=${orgId}` : baseUrl;

  const { data, error, isLoading, mutate } = useSWR<GetApiKeyResponse>(
    ['google/api-key', orgId],
    () => defineFetcher(url),
    {
      revalidateOnFocus: false,
      revalidateIfStale: false,
      dedupingInterval: 60_000,
      focusThrottleInterval: 60_000,
      errorRetryCount: 3,
      loadingTimeout: 10_000,
    }
  );

  return {
    apiKey: data?.apiKey || null,
    isLoading,
    isError: !!error,
    error: error as HttpError | undefined,
    mutate,
  };
}

export function useSetGoogleApiKey(orgId?: string) {
  const baseUrl = `${env.BASE_API_URL}/google/set-api-key`;
  const url = orgId ? `${baseUrl}?orgId=${orgId}` : baseUrl;

  const { trigger, data, error, isMutating } = useSWRMutation<SetApiKeyResponse, HttpError, string, string>(
    url,
    async (url: string, { arg: apiKey }: { arg: string }) => {
      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify({ apiKey }),
      });

      if (!res.ok) {
        const err = new HttpError('Failed to store Google API key.');
        err.status = res.status;
        try {
          err.details = await res.json();
        } catch {
          // ignore
        }
        throw err;
      }

      const text = await res.text();
      return (text ? JSON.parse(text) : null) as SetApiKeyResponse;
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