'use client';

import useSWRMutation from 'swr/mutation';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';
import type { PackageEditChatRequest, PackageEditChatResponse } from '@auto-rfp/core';

/**
 * Cross-package edit chat: a single sync POST that routes intent. A REVIEW turn
 * returns an answer; an EDIT turn returns { intent: 'EDIT', runId } — the caller
 * then polls usePackageEditRun. No history is persisted for this surface (the
 * run + proposals are the durable artifact).
 */
export const usePackageEditChat = (
  orgId: string | undefined,
  projectId: string | undefined,
  oppId: string | undefined,
) => {
  const ready = !!(orgId && projectId && oppId);
  const chatUrl = ready
    ? buildApiUrl('package-edit/chat', { orgId, projectId, opportunityId: oppId })
    : null;

  const { trigger, isMutating: isSending } = useSWRMutation<
    PackageEditChatResponse,
    Error,
    string | null,
    PackageEditChatRequest
  >(chatUrl, (url, { arg }) => apiMutate<PackageEditChatResponse>(url, 'POST', arg));

  const sendMessage = async (message: string): Promise<PackageEditChatResponse | null> => {
    if (!ready || !message.trim()) return null;
    return trigger({ message });
  };

  return { sendMessage, isSending };
};
