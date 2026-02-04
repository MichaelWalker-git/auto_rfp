'use client';

import { env } from '@/lib/env';
import { useAuth } from '@/components/AuthProvider';
import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';

interface SetApiKeyResponse {
  message: string;
  orgId: string;
}

class HttpError extends Error {
  status?: number;
  details?: any;
}

const setApiKeyFetcher = async (
  url: string,
  { arg }: { arg: { apiKey: string } }
): Promise<SetApiKeyResponse> => {
  const res = await authFetcher(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(arg),
  });

  if (!res.ok) {
    const err = new HttpError('Failed to set API key.');
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
};

export function useSetApiKey(orgId?: string) {
  const baseUrl = `${env.BASE_API_URL}/samgov/set-api-key`;
  const url = orgId ? `${baseUrl}?orgId=${orgId}` : baseUrl;

  const { trigger, isMutating, error, data } = useSWRMutation<
    SetApiKeyResponse,
    HttpError,
    string,
    { apiKey: string; orgId?: string }
  >(url, setApiKeyFetcher, {
    revalidate: true,
  });

  const setApiKey = async (apiKey: string): Promise<SetApiKeyResponse> => {
    return trigger({ apiKey, orgId });
  };

  return {
    setApiKey,
    isLoading: isMutating,
    isError: !!error,
    error,
    data,
  };
}
