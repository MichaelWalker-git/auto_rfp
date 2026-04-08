'use client';

import { useCallback, useMemo } from 'react';
import { useOpportunityContext } from '@/components/opportunities/opportunity-context';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';

/**
 * Manages ignored compliance check IDs stored on the opportunity entity.
 * Shared between ComplianceReport (toggle UI) and SubmitProposalButton (readiness override).
 */
export const useIgnoredChecks = (oppId: string) => {
  const { opportunity, orgId, projectId, refetch } = useOpportunityContext();

  const ignoredIds = useMemo(
    () => new Set<string>(opportunity?.ignoredComplianceCheckIds ?? []),
    [opportunity?.ignoredComplianceCheckIds],
  );

  const toggleIgnore = useCallback(async (checkId: string) => {
    const current = new Set<string>(opportunity?.ignoredComplianceCheckIds ?? []);
    if (current.has(checkId)) {
      current.delete(checkId);
    } else {
      current.add(checkId);
    }

    const updatedIds = [...current];

    try {
      await apiMutate(
        buildApiUrl('opportunity/update-opportunity', { orgId }),
        'PUT',
        {
          projectId,
          oppId,
          patch: {
            ignoredComplianceCheckIds: updatedIds,
          },
        },
      );
      refetch();
    } catch (err) {
      console.error('Failed to update ignored checks:', err);
    }
  }, [opportunity?.ignoredComplianceCheckIds, orgId, projectId, oppId, refetch]);

  return { ignoredIds, toggleIgnore };
};
