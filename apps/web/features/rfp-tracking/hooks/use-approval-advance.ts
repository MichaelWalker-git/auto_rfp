'use client';

import { useState, useCallback } from 'react';
import { useSWRConfig } from 'swr';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { RfpApprovalAdvance } from '@auto-rfp/core';
import { rfpPipelineKey } from './use-rfp-pipeline';

interface AdvanceArgs {
  projectId: string;
  oppId: string;
  to: RfpApprovalAdvance['to'];
}

/**
 * Posts a non-gate stage advance and revalidates the pipeline:
 *   I_APPROVED  → PRE_SUB_APPROVAL  "send for pre-sub review"
 *   II_APPROVED → SUBMITTED         "mark submitted"
 */
export function useApprovalAdvance(orgId: string) {
  const { mutate } = useSWRConfig();
  const [pendingOppId, setPendingOppId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const advance = useCallback(
    async ({ projectId, oppId, to }: AdvanceArgs) => {
      setPendingOppId(oppId);
      setError(null);
      try {
        const body: RfpApprovalAdvance = { orgId, projectId, oppId, to };
        await apiMutate(buildApiUrl('dashboard/advance-rfp-approval'), 'POST', body);
        await mutate(rfpPipelineKey(orgId));
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to advance approval');
        return false;
      } finally {
        setPendingOppId(null);
      }
    },
    [orgId, mutate],
  );

  return { advance, pendingOppId, error };
}
