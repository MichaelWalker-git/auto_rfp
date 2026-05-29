'use client';

import useSWR from 'swr';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type { ProjectOutcome } from '@auto-rfp/core';

const baseUrl = `${env.BASE_API_URL}/project-outcome`;

async function outcomeFetcher(url: string) {
  const res = await authFetcher(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Failed to fetch outcome: ${res.status}. ${body}`);
  }
  return res.json();
}

/**
 * Fetch a single outcome for a project or opportunity.
 * When opportunityId is provided, fetches the per-opportunity outcome.
 */
export function useProjectOutcome(
  orgId: string | null,
  projectId: string | null,
  opportunityId?: string | null,
) {
  const params = new URLSearchParams();
  if (orgId) params.set('orgId', orgId);
  if (projectId) params.set('projectId', projectId);
  if (opportunityId) params.set('opportunityId', opportunityId);

  const shouldFetch = !!orgId && !!projectId;
  const key = shouldFetch ? `${baseUrl}/get-outcome?${params.toString()}` : null;

  const { data, error, isLoading, mutate } = useSWR<{ outcome: ProjectOutcome | null }>(
    key,
    outcomeFetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 },
  );

  return {
    outcome: data?.outcome ?? null,
    isLoading,
    isError: !!error,
    error,
    refetch: () => mutate(),
  };
}

interface OutcomeStats {
  won: number;
  lost: number;
  pending: number;
  noBid: number;
  withdrawn: number;
  total: number;
  winRate: number;
  totalContractValue: number;
}

interface GetOutcomesResponse {
  outcomes: ProjectOutcome[];
  count: number;
  stats: OutcomeStats;
}

/**
 * Fetch all outcomes for a project (across all opportunities).
 * Used by the dashboard to show win/loss statistics.
 */
export function useProjectOutcomes(
  orgId: string | null,
  projectId: string | null,
) {
  const shouldFetch = !!orgId && !!projectId;
  const key = shouldFetch
    ? `${baseUrl}/get-outcomes?orgId=${orgId}&projectId=${projectId}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<GetOutcomesResponse>(
    key,
    outcomeFetcher,
    { revalidateOnFocus: false, dedupingInterval: 30000 },
  );

  return {
    outcomes: data?.outcomes ?? [],
    count: data?.count ?? 0,
    stats: data?.stats ?? null,
    isLoading,
    isError: !!error,
    error,
    refetch: () => mutate(),
  };
}
