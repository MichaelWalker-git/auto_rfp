'use client';

import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { AnswerItem, AnswerQuestionRequestBody, AnswerSource, ConfidenceBreakdown, SaveAnswerDTO } from '@auto-rfp/shared';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { breadcrumbs } from '@/lib/sentry';

const BASE = `${env.BASE_API_URL}/answer`;

export function useSaveAnswer(projectId: string) {
  return useSWRMutation<AnswerItem, any, string, SaveAnswerDTO>(
    `${BASE}/save-answer`,
    async (url, { arg }) => {
      const res = await authFetcher(url, {
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

      const answer = await res.json() as AnswerItem;
      breadcrumbs.answerSaved(answer.id);
      return answer;
    },
  );
}

type GenerateAnswerResponse = {
  answer: string;
  confidence: number;
  confidenceBreakdown?: ConfidenceBreakdown;
  confidenceBand?: 'high' | 'medium' | 'low';
  found: boolean;
  sources?: AnswerSource;
}

export function useGenerateAnswer() {
  return useSWRMutation<GenerateAnswerResponse, any, string, AnswerQuestionRequestBody>(
    `${BASE}/generate-answer`,
    async (url, { arg }) => {
      const { orgId, projectId, questionId, topK } = arg;


      const res = await authFetcher(url, {
        method: 'POST',
        body: JSON.stringify({
          orgId,
          projectId,
          questionId,
          topK: topK ?? 15,
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
      const raw = await res.text();

      try {
        return JSON.parse(raw) as GenerateAnswerResponse;
      } catch {
        // not JSON, fall through
      }

      // Fallback – return raw text
      return {} as GenerateAnswerResponse;
    },
  );
}
