'use client';

import { useApi, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { RfpPipelineItem } from '@auto-rfp/core';

interface PipelineResponse {
  ok: boolean;
  items: RfpPipelineItem[];
}

/**
 * Fetches the org-wide opportunity list that powers the board, approval queue,
 * and needs-attention flags. Refreshes every 15 minutes to satisfy the ≤15-min
 * staleness requirement; the SWR key is stable so mutations can revalidate it.
 */
export function useRfpPipeline(orgId: string | null) {
  const url = orgId ? buildApiUrl('dashboard/get-rfp-pipeline', { orgId }) : null;

  const result = useApi<PipelineResponse>(
    orgId ? ['rfp-pipeline', orgId] : null,
    url,
    { revalidateOnFocus: false, refreshInterval: 15 * 60_000, dedupingInterval: 30_000 },
  );

  return {
    ...result,
    items: result.data?.items ?? [],
  };
}

/** Stable SWR key for the pipeline fetch — used by mutations to revalidate. */
export const rfpPipelineKey = (orgId: string) => ['rfp-pipeline', orgId];
