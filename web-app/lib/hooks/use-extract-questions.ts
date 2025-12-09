'use client';

import useSWRMutation from 'swr/mutation';
import { fetchAuthSession } from 'aws-amplify/auth';
import { env } from '@/lib/env';
import { RfpDocument } from '@/types/api';

// ---------- Types ----------

export interface ExtractQuestionsDTO {
  projectId: string;
  documentId: string;
  documentName: string;
  textFileKey: string;
}

export interface ExtractQuestionsResponse {
  rfpDocument: RfpDocument;
}

// ---------- Helper ----------
async function authorizedFetch(url: string, options: RequestInit = {}) {
  let token: string | undefined;

  if (typeof window !== 'undefined') {
    const session = await fetchAuthSession();
    token = session.tokens?.idToken?.toString();
  }

  return fetch(url, {
    ...options,
    headers: {
      ...(token ? { Authorization: token } : {}),
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

const BASE = `${env.BASE_API_URL}/question`;

// ---------- Hook ----------
export function useExtractQuestions() {
  return useSWRMutation<ExtractQuestionsResponse, any, string, ExtractQuestionsDTO>(
    `${BASE}/extract-questions`,
    async (url, { arg }) => {
      const res = await authorizedFetch(url, {
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
