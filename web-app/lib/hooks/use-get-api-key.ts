'use client';

import { env } from '@/lib/env';
import useSWR from 'swr';
import { authFetcher } from '@/lib/auth/auth-fetcher';

interface GetApiKeyResponse {
  message: string;
  apiKey: string;
  orgId: string;
}

class HttpError extends Error {
  status?: number;
  details?: any;
}

const defineFetcher = async (url: string): Promise<GetApiKeyResponse> => {
  const res = await authFetcher(url);

  if (!res.ok) {
    const err = new HttpError('Failed to retrieve API key.');
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

export function useGetApiKey(orgId?: string) {
  const baseUrl = `${env.BASE_API_URL.replace(/\/$/, '')}/samgov/get-api-key`;
  const url = orgId ? `${baseUrl}?orgId=${orgId}` : baseUrl;

  const { data, error, isLoading, mutate } = useSWR<GetApiKeyResponse>(
    ['samgov/api-key', orgId],
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
