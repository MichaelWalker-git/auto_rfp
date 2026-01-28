'use client';

import useSWR from 'swr';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type { ProjectOutcome } from '@auto-rfp/shared';

interface UseProjectOutcomeOptions {
  revalidateOnFocus?: boolean;
  refreshInterval?: number;
}

interface UseProjectOutcomeResult {
  outcome: ProjectOutcome | null;
  isLoading: boolean;
  isError: boolean;
  error: Error | undefined;
  refetch: () => void;
}

export function useProjectOutcome(
  orgId: string | null,
  projectId: string | null,
  options: UseProjectOutcomeOptions = {}
): UseProjectOutcomeResult {
  const shouldFetch = !!orgId && !!projectId;
  const baseUrl = env.BASE_API_URL.replace(/\/$/, '');

  const { data, error, isLoading, mutate } = useSWR<{ outcome: ProjectOutcome | null }>(
    shouldFetch
      ? `${baseUrl}/project-outcome/get-outcome?orgId=${orgId}&projectId=${projectId}`
      : null,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to fetch outcome: ${res.status}. ${body}`);
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
    outcome: data?.outcome ?? null,
    isLoading,
    isError: !!error,
    error,
    refetch: () => mutate(),
  };
}
