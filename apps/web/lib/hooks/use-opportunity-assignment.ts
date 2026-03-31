'use client';

import { useState } from 'react';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AssignOpportunityRequest {
  orgId: string;
  projectId: string;
  oppId: string;
  assigneeId: string | null;
}

interface AssignOpportunityResponse {
  ok: boolean;
  oppId: string;
  assigneeId: string | null;
  assigneeName: string | null;
}

// ─── Hook: Assign Opportunity ─────────────────────────────────────────────────

export const useAssignOpportunity = () => {
  const [isAssigning, setIsAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assign = async (request: AssignOpportunityRequest): Promise<AssignOpportunityResponse> => {
    setIsAssigning(true);
    setError(null);

    try {
      const url = buildApiUrl('opportunity/assign');
      const response = await apiMutate<AssignOpportunityResponse, AssignOpportunityRequest>(
        url,
        'POST',
        request,
      );
      return response;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to assign opportunity';
      setError(message);
      throw err;
    } finally {
      setIsAssigning(false);
    }
  };

  const unassign = async (request: Omit<AssignOpportunityRequest, 'assigneeId'>): Promise<AssignOpportunityResponse> => {
    return assign({ ...request, assigneeId: null });
  };

  return {
    assign,
    unassign,
    isAssigning,
    error,
    clearError: () => setError(null),
  };
};
