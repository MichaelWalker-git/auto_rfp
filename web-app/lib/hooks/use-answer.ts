'use client';

import useSWRMutation from 'swr/mutation';
import { fetchAuthSession } from 'aws-amplify/auth';
import { env } from '@/lib/env';

//
// ================================
// Types (mirror backend)
// ================================
//

export interface Answer {
  id: string;
  questionId: string;
  projectId: string;
  organizationId?: string | null;
  text: string;
  source?: string | null;
  createdAt: string;
  updatedAt: string;
}

// DTO used by create-answer lambda
export interface CreateAnswerDTO {
  questionId: string;
  projectId: string;
  text: string;
  organizationId?: string;
}

//
// ================================
// Helpers
// ================================
//

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

const BASE = `${env.BASE_API_URL}/answer`;

//
// ================================
// CREATE Answer
// (POST /question/create-answer)
// ================================
//

export function useSaveAnswer(projectId: string) {
  return useSWRMutation<Answer, any, string, CreateAnswerDTO>(
    `${BASE}/save-answer`,
    async (url, { arg }) => {
      const res = await authorizedFetch(url, {
        method: 'POST',
        body: JSON.stringify({
          ...arg,
          projectId,
        }),
      });

      if (!res.ok) {
        const message = await res.text().catch(() => '');
        const error = new Error(
          message || 'Failed to create answer',
        ) as Error & { status?: number };
        (error as any).status = res.status;
        throw error;
      }

      return res.json() as Promise<Answer>;
    },
  );
}
type GenerateAnswerArgs = {
  projectId: string;
  questionId: string;
  topK?: number;
};

export function useGenerateAnswer() {
  return useSWRMutation<string, any, string, GenerateAnswerArgs>(
    `${BASE}/generate-answer`,
    async (url, { arg }) => {
      const { projectId, questionId, topK } = arg;

      const res = await authorizedFetch(url, {
        method: 'POST',
        body: JSON.stringify({
          projectId,
          questionId,
          topK: topK ?? 3,
        }),
      });

      if (!res.ok) {
        const message = await res.text().catch(() => '');
        const error = new Error(
          message || 'Failed to generate answer',
        ) as Error & { status?: number };
        (error as any).status = res.status;
        throw error;
      }

      // Prefer JSON { answer: "..." }
      const raw = await res.text();

      try {
        const parsed = JSON.parse(raw);

        // New backend shape: { documentId, questionId, answer }
        if (parsed && typeof parsed.answer === 'string') {
          return parsed.answer;
        }

        // If backend returns plain JSON string: "..."
        if (typeof parsed === 'string') {
          return parsed;
        }
      } catch {
        // not JSON, fall through
      }

      // Fallback – return raw text
      return raw;
    },
  );
}
