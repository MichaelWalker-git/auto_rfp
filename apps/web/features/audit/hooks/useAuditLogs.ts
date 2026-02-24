'use client';

import useSWR from 'swr';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { AuditLogsResponse } from '@auto-rfp/core';

const BASE = `${env.BASE_API_URL}/audit`;

export interface AuditLogFilters {
  orgId: string;
  userId?: string;
  action?: string;
  resource?: string;
  result?: 'success' | 'failure';
  fromDate?: string;
  toDate?: string;
  limit?: number;
  nextToken?: string;
}

export const useAuditLogs = (filters: AuditLogFilters | null) => {
  const key = filters
    ? (() => {
        const params = new URLSearchParams();
        Object.entries(filters).forEach(([k, v]) => {
          if (v !== undefined && v !== '') params.set(k, String(v));
        });
        return `${BASE}/logs?${params.toString()}`;
      })()
    : null;

  const { data, error, isLoading, mutate } = useSWR<AuditLogsResponse>(
    key,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) throw new Error('Failed to fetch audit logs');
      return res.json() as Promise<AuditLogsResponse>;
    },
    { revalidateOnFocus: false },
  );

  return {
    logs: data?.items ?? [],
    count: data?.count ?? 0,
    nextToken: data?.nextToken,
    isLoading,
    isError: !!error,
    mutate,
  };
};
