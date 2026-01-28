'use client';

import useSWR from 'swr';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type { FOIARequestItem, CreateFOIARequest, UpdateFOIARequest } from '@auto-rfp/shared';

interface UseFOIARequestsOptions {
  revalidateOnFocus?: boolean;
  refreshInterval?: number;
}

interface UseFOIARequestsResult {
  foiaRequests: FOIARequestItem[];
  isLoading: boolean;
  isError: boolean;
  error: Error | undefined;
  refetch: () => void;
}

export function useFOIARequests(
  orgId: string | null,
  projectId: string | null,
  options: UseFOIARequestsOptions = {}
): UseFOIARequestsResult {
  const shouldFetch = !!orgId && !!projectId;
  const baseUrl = env.BASE_API_URL.replace(/\/$/, '');

  const { data, error, isLoading, mutate } = useSWR<{ foiaRequests: FOIARequestItem[] }>(
    shouldFetch
      ? `${baseUrl}/foia/get-foia-requests?orgId=${orgId}&projectId=${projectId}`
      : null,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to fetch FOIA requests: ${res.status}. ${body}`);
      }
      return res.json();
    },
    {
      revalidateOnFocus: options.revalidateOnFocus ?? false,
      refreshInterval: options.refreshInterval,
      dedupingInterval: 30000,
    }
  );

  return {
    foiaRequests: data?.foiaRequests ?? [],
    isLoading,
    isError: !!error,
    error,
    refetch: () => mutate(),
  };
}

export function useCreateFOIARequest() {
  const createFOIARequest = async (payload: CreateFOIARequest): Promise<FOIARequestItem> => {
    const baseUrl = env.BASE_API_URL.replace(/\/$/, '');
    const url = `${baseUrl}/foia/create-foia-request`;

    const res = await authFetcher(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Failed to create FOIA request: ${res.status}. ${body}`);
    }

    const data = await res.json();
    return data.foiaRequest as FOIARequestItem;
  };

  return { createFOIARequest };
}

export function useUpdateFOIARequest() {
  const updateFOIARequest = async (payload: UpdateFOIARequest): Promise<FOIARequestItem> => {
    const baseUrl = env.BASE_API_URL.replace(/\/$/, '');
    const url = `${baseUrl}/foia/update-foia-request`;

    const res = await authFetcher(url, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Failed to update FOIA request: ${res.status}. ${body}`);
    }

    const data = await res.json();
    return data.foiaRequest as FOIARequestItem;
  };

  return { updateFOIARequest };
}

export function useGenerateFOIALetter() {
  const generateFOIALetter = async (
    orgId: string,
    projectId: string,
    foiaRequestId: string
  ): Promise<string> => {
    const baseUrl = env.BASE_API_URL.replace(/\/$/, '');
    const url = `${baseUrl}/foia/generate-foia-letter?orgId=${orgId}&projectId=${projectId}&foiaRequestId=${foiaRequestId}`;

    const res = await authFetcher(url);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Failed to generate FOIA letter: ${res.status}. ${body}`);
    }

    const data = await res.json();
    return data.letter as string;
  };

  return { generateFOIALetter };
}
