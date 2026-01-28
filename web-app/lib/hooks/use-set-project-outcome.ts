'use client';

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
      return data.outcome as ProjectOutcome;
    } finally {
      isSubmitting = false;
    }
  };

  return { setOutcome, isSubmitting };
}
