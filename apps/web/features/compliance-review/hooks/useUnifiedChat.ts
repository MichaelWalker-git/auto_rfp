'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { apiFetcher, apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import { usePermission } from '@/components/permission-wrapper';
import type {
  ComplianceReviewHistoryResponse,
  ComplianceReviewChatResponse,
  PackageEditChatResponse,
} from '@auto-rfp/core';

/**
 * Single chat surface that routes by permission (one seamless UI, two
 * permission-scoped endpoints behind it — see PACKAGE-EDIT §11):
 *   - Editors (proposal:edit) → package-edit/chat, which BOTH answers review
 *     questions and detects edit intent (kicks off a proposal run).
 *   - Read-only users → compliance-review/chat (review only; can't start edits).
 *
 * Both endpoints persist to the SAME compliance-review chat history, so this hook
 * reads one unified, refresh-safe stream. An assistant message with `editRunId`
 * is an edit turn the UI renders inline (ProposalRunView).
 */
export const useUnifiedChat = (
  orgId: string | undefined,
  projectId: string | undefined,
  oppId: string | undefined,
) => {
  const canEdit = usePermission('proposal:edit');
  const ready = !!(orgId && projectId && oppId);
  const params = ready ? { orgId, projectId, opportunityId: oppId } : undefined;

  const historyUrl = params ? buildApiUrl('compliance-review/history', params) : null;
  const {
    data: history,
    isLoading: isLoadingHistory,
    mutate: mutateHistory,
  } = useSWR<ComplianceReviewHistoryResponse>(historyUrl, apiFetcher, { revalidateOnFocus: false });

  // Route to the endpoint the user is allowed to use.
  const endpoint = canEdit ? 'package-edit/chat' : 'compliance-review/chat';
  const chatUrl = params ? buildApiUrl(endpoint, params) : null;

  const { trigger, isMutating: isSending } = useSWRMutation<
    ComplianceReviewChatResponse | PackageEditChatResponse,
    Error,
    string | null,
    { message: string }
  >(chatUrl, (url, { arg }) => apiMutate<ComplianceReviewChatResponse | PackageEditChatResponse>(url, 'POST', arg));

  const sendMessage = async (message: string) => {
    if (!ready || !message.trim()) return null;
    const response = await trigger({ message });
    await mutateHistory(); // both endpoints persist to the shared history
    return response;
  };

  return {
    messages: history?.messages ?? [],
    isLoadingHistory,
    sendMessage,
    isSending,
    canEdit,
    refetchHistory: mutateHistory,
  };
};
