'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { apiFetcher, apiMutate, buildApiUrl, ApiError } from './api-helpers';
import { AnswerGenerationStatusResponse, AnswerItem, AnswerQuestionRequestBody, type AnswerResolution, AnswerSource, ConfidenceBreakdown, SaveAnswerDTO } from '@auto-rfp/core';
import { breadcrumbs } from '@/lib/sentry';

type GenerateAnswerResponse = {
  answer: string;
  confidence: number;
  confidenceBreakdown?: ConfidenceBreakdown;
  confidenceBand?: 'high' | 'medium' | 'low';
  found: boolean;
  resolution?: AnswerResolution;
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
      const { orgId, projectId, questionId, opportunityId, questionFileId, topK } = arg;
      return apiMutate<GenerateAnswerResponse>(url, 'POST', {
        orgId,
        projectId,
        questionId,
        opportunityId,
        questionFileId,
        topK: topK ?? 15,
      });
    },
  );
}

/** Poll interval (ms) while a run is active — tight so spinners clear promptly. */
const GENERATION_STATUS_ACTIVE_POLL_MS = 4_000;
/**
 * Poll interval (ms) while idle. We MUST keep polling when idle, otherwise a run
 * that starts after the page loads is never noticed (the status key would stay
 * stale forever and no spinner would ever appear). 15s is a cheap control-plane
 * call that keeps fixed cost negligible while still catching a starting run.
 */
const GENERATION_STATUS_IDLE_POLL_MS = 15_000;

/**
 * Reports whether the answer-generation Step Function is currently running for
 * an opportunity. This is the authoritative "is generation in flight" signal —
 * unlike per-file status it also covers cluster-copied questions that have no
 * QUESTION_FILE record.
 *
 * Polls every 15s while idle (to catch a run that starts after load) and every
 * 4s while a run is active (so spinners appear and clear promptly).
 */
export function useAnswerGenerationStatus(
  projectId: string | null,
  opportunityId: string | null,
  orgId: string | null,
) {
  const shouldFetch = !!projectId && !!opportunityId && !!orgId;
  const key = shouldFetch
    ? buildApiUrl(`answer/generation-status/${projectId}`, { orgId, opportunityId })
    : null;

  const { data, error, isLoading, mutate } = useSWR<AnswerGenerationStatusResponse>(
    key,
    (url: string) => apiFetcher<AnswerGenerationStatusResponse>(url),
    {
      // Revalidate on focus so returning to the tab during a run shows it immediately.
      revalidateOnFocus: true,
      refreshInterval: (latest) =>
        latest?.isGenerating ? GENERATION_STATUS_ACTIVE_POLL_MS : GENERATION_STATUS_IDLE_POLL_MS,
    },
  );

  return {
    isGenerating: data?.isGenerating ?? false,
    executionArn: data?.executionArn,
    isLoading,
    isError: !!error,
    mutate,
  };
}
