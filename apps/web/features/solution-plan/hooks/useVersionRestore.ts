'use client';

import { useCallback, useState } from 'react';
import { useSWRConfig } from 'swr';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import { useToast } from '@/components/ui/use-toast';
import type { SolutionPlanVersionRestoreResponse } from '@auto-rfp/core';
import { mapRestoreError, VERSION_NOT_FOUND_MESSAGE } from '../lib/version-errors';
import { versionListKey } from './useVersionList';

export type VersionRestoreResult =
  | { outcome: 'restored' }
  | { outcome: 'not-found' | 'current-conflict' | 'generating' | 'error'; message: string };

/**
 * POST /solution-plan/version/restore (contract C2) — restore-as-new: the
 * selected version's content becomes the new current plan, the previous
 * current is preserved in history (W4). On success the hook toasts and
 * revalidates BOTH the version list and the plan (content/header) via the
 * caller-supplied `onRestored`. On failure the plan is never revalidated —
 * the plan view stays unchanged (AC4.1.5) — and the mapped outcome carries
 * its specific plain-language message (current-conflict vs generating vs
 * vanished vs generic).
 */
export const useVersionRestore = (
  orgId: string | undefined,
  projectId: string | undefined,
  opportunityId: string | undefined,
  { onRestored }: { onRestored?: () => void | Promise<unknown> } = {},
) => {
  const { toast } = useToast();
  const { mutate } = useSWRConfig();
  const [isRestoring, setIsRestoring] = useState(false);

  const restoreVersion = useCallback(
    async (versionId: string): Promise<VersionRestoreResult> => {
      const listKey = versionListKey(orgId, projectId, opportunityId);
      if (!orgId || !projectId || !opportunityId || !listKey) {
        return { outcome: 'error', message: 'Missing plan identifiers.' };
      }

      setIsRestoring(true);
      try {
        await apiMutate<SolutionPlanVersionRestoreResponse>(
          buildApiUrl('solution-plan/version/restore', { orgId }),
          'POST',
          { orgId, projectId, opportunityId, versionId },
        );
        toast({ title: 'Version restored' });
        await Promise.all([mutate(listKey), onRestored?.()]);
        return { outcome: 'restored' };
      } catch (err) {
        const failure = mapRestoreError(err);
        if (failure.outcome === 'not-found') {
          toast({
            title: 'Version not found',
            description: VERSION_NOT_FOUND_MESSAGE,
            variant: 'destructive',
          });
          await mutate(listKey);
        }
        if (failure.outcome === 'current-conflict') {
          // The list was stale — refresh so "current" is marked correctly.
          await mutate(listKey);
        }
        return failure;
      } finally {
        setIsRestoring(false);
      }
    },
    [orgId, projectId, opportunityId, toast, mutate, onRestored],
  );

  return { restoreVersion, isRestoring };
};
