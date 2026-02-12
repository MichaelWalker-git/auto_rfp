'use client';

import { mutate } from 'swr';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import type { SetProjectOutcomeRequest, ProjectOutcome } from '@auto-rfp/shared';

interface SetProjectOutcomeResult {
  setOutcome: (payload: SetProjectOutcomeRequest) => Promise<ProjectOutcome>;
  isSubmitting: boolean;
}

export function useSetProjectOutcome(): SetProjectOutcomeResult {
  let isSubmitting = false;

  const setOutcome = async (payload: SetProjectOutcomeRequest): Promise<ProjectOutcome> => {
    isSubmitting = true;

    try {
      const baseUrl = env.BASE_API_URL.replace(/\/$/, '');
      const url = `${baseUrl}/project-outcome/set-outcome`;

      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Failed to set outcome: ${res.status}. ${body}`);
      }

      const data = await res.json();
      const outcome = data.outcome as ProjectOutcome;

      // Invalidate SWR cache for outcome queries to trigger refetch
      // This will refresh the dashboard's outcome statistics
      const outcomeBaseUrl = `${baseUrl}/project-outcome`;
      const opportunityId = (payload as { opportunityId?: string }).opportunityId;
      
      // Invalidate the list of all outcomes for this project (used by dashboard)
      mutate(
        `${outcomeBaseUrl}/get-outcome?orgId=${payload.orgId}&projectId=${payload.projectId}&list=true`
      );
      
      // Invalidate the specific outcome (with or without opportunityId)
      if (opportunityId) {
        mutate(
          `${outcomeBaseUrl}/get-outcome?orgId=${payload.orgId}&projectId=${payload.projectId}&opportunityId=${opportunityId}`
        );
      } else {
        mutate(
          `${outcomeBaseUrl}/get-outcome?orgId=${payload.orgId}&projectId=${payload.projectId}`
        );
      }

      return outcome;
    } finally {
      isSubmitting = false;
    }
  };

  return { setOutcome, isSubmitting };
}
