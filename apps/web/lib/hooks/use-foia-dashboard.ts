'use client';

import type { FoiaDashboardResponse } from '@auto-rfp/core';
import { buildApiUrl, useApi } from './api-helpers';

/**
 * Org-wide FOIA comparison data for the dashboard.
 *
 * Follows `use-analytics.ts` rather than the other FOIA hooks: those call `useSWR`
 * directly, but this renders on the analytics page and should share that page's
 * caching behaviour. One aggregate request; all series are derived client-side.
 *
 * Not date-filtered. The dashboard's month range applies to the analytics series, and
 * a FOIA response can arrive months after the outcome it describes — windowing on the
 * response date would hide the comparison, and windowing on the outcome date would
 * hide responses that just came back. Both are the opposite of useful here.
 */
export const useFoiaDashboard = (orgId: string | null) => {
  const url = orgId ? buildApiUrl('foia/get-foia-dashboard', { orgId }) : null;

  return useApi<{ dashboard: FoiaDashboardResponse }>(
    orgId ? ['foia-dashboard', orgId] : null,
    url,
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  );
};
