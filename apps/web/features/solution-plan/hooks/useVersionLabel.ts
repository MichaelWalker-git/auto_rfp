'use client';

import { useCallback, useState } from 'react';
import { useSWRConfig } from 'swr';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import { useToast } from '@/components/ui/use-toast';
import type { SolutionPlanVersionLabelResponse } from '@auto-rfp/core';
import { mapLabelError, VERSION_NOT_FOUND_MESSAGE } from '../lib/version-errors';
import { versionListKey } from './useVersionList';

export type VersionLabelSaveResult = {
  outcome: 'saved' | 'validation' | 'not-found' | 'error';
};

/**
 * PATCH /solution-plan/version/label (contract C1) — set, rename, or clear a
 * version's label (empty/whitespace clears, W5). Outcome mapping:
 * `validation` (400 — the server-side length rejection, shown as the SAME
 * inline message as the client check), `not-found` (vanished → toast + list
 * refresh), `error` (keep the typed value, retry hint). Success toasts and
 * revalidates the list.
 */
export const useVersionLabel = (
  orgId: string | undefined,
  projectId: string | undefined,
  opportunityId: string | undefined,
) => {
  const { toast } = useToast();
  const { mutate } = useSWRConfig();
  const [isSaving, setIsSaving] = useState(false);

  const saveLabel = useCallback(
    async (versionId: string, label: string): Promise<VersionLabelSaveResult> => {
      const listKey = versionListKey(orgId, projectId, opportunityId);
      if (!orgId || !projectId || !opportunityId || !listKey) return { outcome: 'error' };

      setIsSaving(true);
      try {
        const trimmed = label.trim();
        await apiMutate<SolutionPlanVersionLabelResponse>(
          buildApiUrl('solution-plan/version/label', { orgId }),
          'PATCH',
          { orgId, projectId, opportunityId, versionId, label: trimmed },
        );
        toast({ title: trimmed ? 'Label saved' : 'Label cleared' });
        await mutate(listKey);
        return { outcome: 'saved' };
      } catch (err) {
        const failure = mapLabelError(err);
        if (failure.outcome === 'not-found') {
          toast({
            title: 'Version not found',
            description: VERSION_NOT_FOUND_MESSAGE,
            variant: 'destructive',
          });
          await mutate(listKey);
        }
        return failure;
      } finally {
        setIsSaving(false);
      }
    },
    [orgId, projectId, opportunityId, toast, mutate],
  );

  return { saveLabel, isSaving };
};
