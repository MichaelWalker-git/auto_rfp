'use client';

import { useCallback, useState } from 'react';
import { useSWRConfig } from 'swr';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import { useToast } from '@/components/ui/use-toast';
import type { SolutionPlanVersionDeleteResponse } from '@auto-rfp/core';
import { mapDeleteError, VERSION_NOT_FOUND_MESSAGE } from '../lib/version-errors';
import { versionListKey } from './useVersionList';

export type VersionDeleteResult =
  | { outcome: 'deleted' }
  | { outcome: 'not-found' | 'current-conflict' | 'error'; message: string };

/**
 * DELETE /solution-plan/version (contract C1) — remove a non-current version
 * (W6). Outcome mapping: `not-found` (already deleted → toast + list
 * refresh), `current-conflict` (the list was stale and the target became
 * current → report + list refresh), `error` (the row stays, retryable).
 * Success toasts and revalidates the list (the row disappears).
 */
export const useVersionDelete = (
  orgId: string | undefined,
  projectId: string | undefined,
  opportunityId: string | undefined,
) => {
  const { toast } = useToast();
  const { mutate } = useSWRConfig();
  const [isDeleting, setIsDeleting] = useState(false);

  const deleteVersion = useCallback(
    async (versionId: string): Promise<VersionDeleteResult> => {
      const listKey = versionListKey(orgId, projectId, opportunityId);
      if (!orgId || !projectId || !opportunityId || !listKey) {
        return { outcome: 'error', message: 'Missing plan identifiers.' };
      }

      setIsDeleting(true);
      try {
        await apiMutate<SolutionPlanVersionDeleteResponse>(
          buildApiUrl('solution-plan/version', { orgId, projectId, opportunityId, versionId }),
          'DELETE',
        );
        toast({ title: 'Version deleted' });
        await mutate(listKey);
        return { outcome: 'deleted' };
      } catch (err) {
        const failure = mapDeleteError(err);
        if (failure.outcome === 'not-found') {
          toast({
            title: 'Version not found',
            description: VERSION_NOT_FOUND_MESSAGE,
            variant: 'destructive',
          });
          await mutate(listKey);
        }
        if (failure.outcome === 'current-conflict') {
          // The list was stale — refresh so the row shows its Current badge.
          await mutate(listKey);
        }
        return failure;
      } finally {
        setIsDeleting(false);
      }
    },
    [orgId, projectId, opportunityId, toast, mutate],
  );

  return { deleteVersion, isDeleting };
};
