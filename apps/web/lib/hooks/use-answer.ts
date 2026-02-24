'use client';

import useSWRMutation from 'swr/mutation';
import { apiMutate, buildApiUrl, ApiError } from './api-helpers';
import { AnswerItem, AnswerQuestionRequestBody, AnswerSource, ConfidenceBreakdown, SaveAnswerDTO } from '@auto-rfp/core';
import { breadcrumbs } from '@/lib/sentry';

type GenerateAnswerResponse = {
  answer: string;
  confidence: number;
  confidenceBreakdown?: ConfidenceBreakdown;
  confidenceBand?: 'high' | 'medium' | 'low';
  found: boolean;
  sources?: AnswerSource[];
};

export function useSaveAnswer(projectId: string) {
  return useSWRMutation<AnswerItem, ApiError, string, SaveAnswerDTO>(
    buildApiUrl('answer/save-answer'),
    async (url, { arg }) => {
      const answer = await apiMutate<AnswerItem>(url, 'POST', { ...arg, projectId });
      breadcrumbs.answerSaved(answer.id);
      return answer;
    },
  );
}

export function useApproveAnswer(projectId: string) {
  return useSWRMutation<AnswerItem, ApiError, string, SaveAnswerDTO>(
    buildApiUrl('answer/save-answer'),
    async (url, { arg }) => {
      const answer = await apiMutate<AnswerItem>(url, 'POST', {
        ...arg,
        projectId,
        status: 'APPROVED',
      });
      breadcrumbs.answerSaved(answer.id);
      return answer;
    },
  );
}

export function useGenerateAnswer() {
  return useSWRMutation<GenerateAnswerResponse, ApiError, string, AnswerQuestionRequestBody>(
    buildApiUrl('answer/generate-answer'),
    async (url, { arg }) => {
      const { orgId, projectId, questionId, topK } = arg;
      return apiMutate<GenerateAnswerResponse>(url, 'POST', {
        orgId,
        projectId,
        questionId,
        topK: topK ?? 15,
      });
    },
  );
}
