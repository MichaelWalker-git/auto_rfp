'use client';

import { useState, useCallback } from 'react';
import { useSWRConfig } from 'swr';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { AceStage, UpdateAceStage } from '@auto-rfp/core';
import { rfpPipelineKey } from './use-rfp-pipeline';

interface SetStageArgs {
  projectId: string;
  oppId: string;
  aceStage: AceStage;
}

/**
 * Posts a manual ACE (AWS Partner Central) stage change and revalidates the
 * pipeline. The backend commits the local value first and pushes to Partner
 * Central best-effort — a PC failure still returns 200, so the dropdown value
 * sticks and the sync error surfaces via the item's apnSyncError badge.
 */
export function useAceStage(orgId: string) {
  const { mutate } = useSWRConfig();
  const [pendingOppId, setPendingOppId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const setStage = useCallback(
    async ({ projectId, oppId, aceStage }: SetStageArgs) => {
      setPendingOppId(oppId);
      setError(null);
      try {
        const body: UpdateAceStage = { orgId, projectId, oppId, aceStage };
        await apiMutate(buildApiUrl('dashboard/update-ace-stage'), 'POST', body);
        await mutate(rfpPipelineKey(orgId));
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update ACE stage');
        return false;
      } finally {
        setPendingOppId(null);
      }
    },
    [orgId, mutate],
  );

  return { setStage, pendingOppId, error };
}
