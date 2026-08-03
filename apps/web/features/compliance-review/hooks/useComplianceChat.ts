'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { apiFetcher, apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type {
  ComplianceReviewChatResponse,
  ComplianceReviewHistoryResponse,
} from '@auto-rfp/core';

/**
 * Synchronous compliance-review chat: history (SWR) + send (SWR mutation).
 */
export const useComplianceChat = (
  orgId: string | undefined,
  projectId: string | undefined,
  oppId: string | undefined,
) => {
  const ready = !!(orgId && projectId && oppId);
  const params = ready ? { orgId, projectId, opportunityId: oppId } : undefined;

  const historyUrl = params ? buildApiUrl('compliance-review/history', params) : null;
  const {
    data: history,
    isLoading: isLoadingHistory,
    mutate: mutateHistory,
  } = useSWR<ComplianceReviewHistoryResponse>(historyUrl, apiFetcher, { revalidateOnFocus: false });

  const chatUrl = params ? buildApiUrl('compliance-review/chat', params) : null;
  const { trigger, isMutating: isSending } = useSWRMutation<
    ComplianceReviewChatResponse,
    Error,
    string | null,
    { message: string }
  >(chatUrl, (url, { arg }) => apiMutate<ComplianceReviewChatResponse>(url, 'POST', arg));

  const sendMessage = async (message: string) => {
    if (!ready || !message.trim()) return null;
    const response = await trigger({ message });
    await mutateHistory();
    return response;
  };

  return {
    messages: history?.messages ?? [],
    isLoadingHistory,
    sendMessage,
    isSending,
    refetchHistory: mutateHistory,
  };
};
