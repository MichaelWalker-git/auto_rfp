'use client';

import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';

export type GenerateExecutiveBriefResponse = {
  ok: boolean;
  executiveBrief?: unknown;
  message?: string;
};

export function useGenerateExecutiveBrief() {
  return useSWRMutation<
    GenerateExecutiveBriefResponse,
    Error,
    string,
    { projectId: string }
  >(
    `${env.BASE_API_URL}/brief/generate-executive-brief`,
    async (url, { arg }) => {
      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify({ projectId: arg.projectId }),
      });

      if (!res.ok) {
        const raw = await res.text().catch(() => '');
        const err = new Error(raw || 'Failed to generate executive brief');
        (err as any).status = res.status;
        throw err;
      }

      const raw = await res.text().catch(() => '');
      if (!raw) return { ok: true };

      try {
        return JSON.parse(raw) as GenerateExecutiveBriefResponse;
      } catch {
        return { ok: true };
      }
    },
  );
}
