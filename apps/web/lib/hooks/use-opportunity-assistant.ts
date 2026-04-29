'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { z } from 'zod';
import type {
  ChatSourceCitation,
  OpportunityAssistantMessage,
  OpportunityAssistantChatRequest,
  OpportunityAssistantChatResponse,
  OpportunityAssistantHistoryResponse,
} from '@auto-rfp/core';

// Re-export types from shared for convenience
export type { ChatSourceCitation, OpportunityAssistantMessage };
export type { OpportunityAssistantChatRequest, OpportunityAssistantChatResponse, OpportunityAssistantHistoryResponse };

// ─── Helpers ───

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

const postJson = async <T>(url: string, body: unknown): Promise<T> => {
  const res = await authFetcher(url, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const raw = await res.text().catch(() => '');
    throw new ApiError(raw || 'Request failed', res.status);
  }
  const raw = await res.text().catch(() => '');
  if (!raw) return { ok: true } as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return { ok: true } as T;
  }
};

const BASE = `${env.BASE_API_URL}/opportunity-assistant`;

// ─── Hooks ───

/**
 * Fetch chat history for an opportunity's AI assistant.
 * Returns messages ordered by timestamp ascending (oldest first).
 */
export function useOpportunityAssistantHistory(
  opportunityId: string | null,
  orgId: string | null,
  projectId: string | null,
) {
  const params = new URLSearchParams();
  if (opportunityId) params.set('opportunityId', opportunityId);
  if (orgId) params.set('orgId', orgId);
  if (projectId) params.set('projectId', projectId);

  const key =
    opportunityId && orgId && projectId
      ? `${BASE}/history?${params.toString()}`
      : null;

  const { data, error, isLoading, mutate } = useSWR<OpportunityAssistantHistoryResponse>(
    key,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) throw new Error('Failed to fetch chat history');
      return res.json();
    },
    { revalidateOnFocus: false },
  );

  return {
    messages: data?.messages ?? [],
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

/**
 * Send a chat message to the opportunity assistant.
 * Returns AI answer with source citations.
 */
export function useSendOpportunityAssistantMessage(
  opportunityId: string | null,
  orgId: string | null,
  projectId: string | null,
) {
  const params = new URLSearchParams();
  if (opportunityId) params.set('opportunityId', opportunityId);
  if (orgId) params.set('orgId', orgId);
  if (projectId) params.set('projectId', projectId);

  return useSWRMutation<
    OpportunityAssistantChatResponse,
    Error,
    string | null,
    OpportunityAssistantChatRequest
  >(
    opportunityId && orgId && projectId 
      ? `${BASE}/chat?${params.toString()}` 
      : null,
    (url, { arg }) => postJson<OpportunityAssistantChatResponse>(url, arg),
  );
}

/**
 * Combined hook for the opportunity assistant chat interface.
 * Provides history fetching and message sending in one hook.
 *
 * @param opportunityId - UUID of the opportunity to chat about
 * @param orgId - UUID of the organization
 * @param projectId - UUID of the project
 * @returns Chat history, loading states, error states, and send function
 */
export function useOpportunityAssistant(
  opportunityId: string | null,
  orgId: string | null,
  projectId: string | null,
) {
  const {
    messages,
    isLoading: isLoadingHistory,
    isError: historyError,
    mutate: mutateHistory,
  } = useOpportunityAssistantHistory(opportunityId, orgId, projectId);

  const {
    trigger: sendMessageTrigger,
    isMutating: isSubmitting,
    error: sendError,
  } = useSendOpportunityAssistantMessage(opportunityId, orgId, projectId);

  const sendMessage = async (message: string) => {
    if (!opportunityId || !message.trim()) return null;

    const response = await sendMessageTrigger({ message });
    // Refetch history to include new messages
    await mutateHistory();
    return response;
  };

  return {
    messages,
    isLoadingHistory,
    historyError,
    sendMessage,
    isSubmitting,
    sendError,
    refetchHistory: mutateHistory,
  };
}
