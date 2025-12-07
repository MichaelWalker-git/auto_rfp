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

export function useCreateAnswer(projectId: string) {
  return useSWRMutation<Answer, any, string, CreateAnswerDTO>(
    `${BASE}/create-answer`,
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


//
// ================================
// GENERATE Answer (RAG)
// (POST /answer/generate-answer)
// ================================
//

type GenerateAnswerArgs = {
  question: string;
  topK?: number;
};

export function useGenerateAnswer() {
  return useSWRMutation<string, any, string, GenerateAnswerArgs>(
    `${BASE}/generate-answer`,
    async (url, { arg }) => {
      const { question, topK } = arg;

      const res = await authorizedFetch(url, {
        method: 'POST',
        body: JSON.stringify({
          question,
          // backend currently sends it as string, so we stringify here
          topK: topK != null ? String(topK) : '3',
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

      // Try to be flexible with response shape:
      //  - { answer: "..." }
      //  - "..." (plain string body)
      const raw = await res.text();

      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.answer === 'string') {
          return parsed.answer;
        }
        // if backend just returns a string JSON: "..."
        if (typeof parsed === 'string') {
          return parsed;
        }
      } catch {
        // not JSON, fall through
      }

      return raw;
    },
  );
}
