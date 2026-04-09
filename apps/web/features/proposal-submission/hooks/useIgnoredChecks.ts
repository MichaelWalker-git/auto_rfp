'use client';

import { useCallback, useMemo } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { OpportunityItem } from '@auto-rfp/core';

interface UseIgnoredChecksArgs {
  orgId: string;
  projectId: string;
  oppId: string;
  opportunity: OpportunityItem | Record<string, unknown> | null;
  refetch: () => void;
}

/**
 * Manages ignored compliance check IDs stored on the opportunity entity.
 * Works both inside and outside OpportunityProvider — just pass the data directly.
 */
export const useIgnoredChecks = (args: UseIgnoredChecksArgs) => {
  const { orgId, projectId, oppId, opportunity, refetch } = args;

  const ignoredCheckIds = (opportunity as Record<string, unknown> | null)?.ignoredComplianceCheckIds as string[] | undefined;

  const ignoredIds = useMemo(
    () => new Set<string>(ignoredCheckIds ?? []),
    [ignoredCheckIds],
  );

  const toggleIgnore = useCallback(async (checkId: string) => {
    const current = new Set<string>(ignoredCheckIds ?? []);
    if (current.has(checkId)) {
      current.delete(checkId);
    } else {
      current.add(checkId);
    }

    try {
      await apiMutate(
        buildApiUrl('opportunity/update-opportunity', { orgId }),
        'PUT',
        {
          projectId,
          oppId,
          patch: { ignoredComplianceCheckIds: [...current] },
        },
      );
      refetch();
    } catch (err) {
      console.error('Failed to update ignored checks:', err);
    }
  }, [ignoredCheckIds, orgId, projectId, oppId, refetch]);

  return { ignoredIds, toggleIgnore };
};
