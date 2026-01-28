'use client';

import useSWR from 'swr';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type { DebriefingItem, CreateDebriefingRequest, UpdateDebriefingRequest } from '@auto-rfp/shared';

interface UseDebriefingOptions {
  revalidateOnFocus?: boolean;
  refreshInterval?: number;
}

interface UseDebriefingResult {
  debriefings: DebriefingItem[];
  isLoading: boolean;
  isError: boolean;
  error: Error | undefined;
  refetch: () => void;
}

export function useDebriefings(
  orgId: string | null,
  projectId: string | null,
  options: UseDebriefingOptions = {}
): UseDebriefingResult {
  const shouldFetch = !!orgId && !!projectId;
  const baseUrl = env.BASE_API_URL.replace(/\/$/, '');

  const { data, error, isLoading, mutate } = useSWR<{ debriefings: DebriefingItem[] }>(
    shouldFetch
      ? `${baseUrl}/debriefing/get-debriefing?orgId=${orgId}&projectId=${projectId}`
      : null,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to fetch debriefings: ${res.status}. ${body}`);
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
    debriefings: data?.debriefings ?? [],
    isLoading,
    isError: !!error,
    error,
    refetch: () => mutate(),
  };
}

export function useCreateDebriefing() {
  const createDebriefing = async (payload: CreateDebriefingRequest): Promise<DebriefingItem> => {
    const baseUrl = env.BASE_API_URL.replace(/\/$/, '');
    const url = `${baseUrl}/debriefing/create-debriefing`;

    const res = await authFetcher(url, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Failed to create debriefing: ${res.status}. ${body}`);
    }

    const data = await res.json();
    return data.debriefing as DebriefingItem;
  };

  return { createDebriefing };
}

export function useUpdateDebriefing() {
  const updateDebriefing = async (payload: UpdateDebriefingRequest): Promise<DebriefingItem> => {
    const baseUrl = env.BASE_API_URL.replace(/\/$/, '');
    const url = `${baseUrl}/debriefing/update-debriefing`;

    const res = await authFetcher(url, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Failed to update debriefing: ${res.status}. ${body}`);
    }

    const data = await res.json();
    return data.debriefing as DebriefingItem;
  };

  return { updateDebriefing };
}
