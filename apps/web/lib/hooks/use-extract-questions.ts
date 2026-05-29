'use client';

import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { ExtractQuestionsResponse } from '@/lib/validators/extract-questions';
import { authFetcher } from '@/lib/auth/auth-fetcher';

export interface ExtractQuestionsDTO {
  projectId: string;
  documentId: string;
  documentName: string;
  textFileKey: string;
}

const BASE = `${env.BASE_API_URL}/question`;

export function useExtractQuestions() {
  return useSWRMutation<ExtractQuestionsResponse, any, string, ExtractQuestionsDTO>(
    `${BASE}/extract-questions`,
    async (url, { arg }) => {
      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify(arg),
      });

      if (!res.ok) {
        const message = await res.text().catch(() => '');
        const error = new Error(
          message || 'Failed to start question extraction',
        ) as Error & { status?: number };

        (error as any).status = res.status;
        throw error;
      }

      return res.json() as Promise<ExtractQuestionsResponse>;
    },
  );
}
