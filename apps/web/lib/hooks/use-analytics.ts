'use client';

import useSWR from 'swr';
import { useApi, buildApiUrl } from './api-helpers';
import type { GetAnalyticsResponse } from '@auto-rfp/core';
import { formatMonth } from '@auto-rfp/core';

// ─── Analytics Hook ───

export function useAnalytics(
  orgId: string | null,
  startMonth?: string,
  endMonth?: string,
) {
  const now = new Date();
  const defaultEnd = formatMonth(now);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const defaultStart = formatMonth(sixMonthsAgo);

  const start = startMonth ?? defaultStart;
  const end = endMonth ?? defaultEnd;

  const url = orgId
    ? buildApiUrl('analytics/get-analytics', { orgId, startMonth: start, endMonth: end })
    : null;

  return useApi<GetAnalyticsResponse>(
    orgId ? ['analytics', orgId, start, end] : null,
    url,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
}
