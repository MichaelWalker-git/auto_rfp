'use client';

import { useState, useCallback } from 'react';
import { useSWRConfig } from 'swr';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { RfpApprovalDecision } from '@auto-rfp/core';
import { rfpPipelineKey } from './use-rfp-pipeline';

interface DecisionArgs {
  projectId: string;
  oppId: string;
  gate: RfpApprovalDecision['gate'];
  decision: RfpApprovalDecision['decision'];
  reason?: string;
}

/**
 * Posts a two-gate approval decision and revalidates the pipeline so the board
 * and queues reflect the new approvalStatus.
 *   INITIAL + APPROVE → I_APPROVED, INITIAL + REJECT → NOT_APPROVED
 *   FINAL   + APPROVE → II_APPROVED
 */
export function useApprovalDecision(orgId: string) {
  const { mutate } = useSWRConfig();
  const [pendingOppId, setPendingOppId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = useCallback(
    async ({ projectId, oppId, gate, decision, reason }: DecisionArgs) => {
      setPendingOppId(oppId);
      setError(null);
      try {
        const body: RfpApprovalDecision = { orgId, projectId, oppId, gate, decision, reason };
        await apiMutate(buildApiUrl('dashboard/decide-rfp-approval'), 'POST', body);
        await mutate(rfpPipelineKey(orgId));
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to record decision');
        return false;
      } finally {
        setPendingOppId(null);
      }
    },
    [orgId, mutate],
  );

  return { decide, pendingOppId, error };
}
