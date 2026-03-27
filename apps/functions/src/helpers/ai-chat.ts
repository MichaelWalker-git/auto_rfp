/**
 * DynamoDB helpers for AI Chat message persistence.
 *
 * PK: AI_CHAT_MESSAGE
 * SK: {orgId}#{projectId}#{opportunityId}#{documentId}#{timestamp}#{messageId}
 *
 * Query pattern: all messages for a document via SK prefix.
 */
import { v4 as uuidv4 } from 'uuid';
import { putItem, queryBySkPrefix, deleteAllBySkPrefix } from '@/helpers/db';
import { AI_CHAT_MESSAGE_PK } from '@/constants/ai-chat';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { nowIso } from '@/helpers/date';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIChatMessageItem {
  [key: string]: unknown;
  messageId: string;
  documentId: string;
  projectId: string;
  opportunityId: string;
  orgId: string;
  role: 'user' | 'assistant';
  content: string;
  sectionTitle: string;
  /** For assistant messages: the updated HTML that was applied */
  updatedHtml?: string;
  /** Whether this edit was successfully applied */
  applied?: boolean;
  /** Error message if the request failed */
  error?: string;
  /** Number of tool rounds used (assistant only) */
  toolRoundsUsed?: number;
  /** User ID who sent the message */
  userId?: string;
  timestamp: string;
  createdAt: string;
}

// ─── SK Builder ───────────────────────────────────────────────────────────────

const buildDocumentPrefix = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
): string => `${orgId}#${projectId}#${opportunityId}#${documentId}`;

const buildMessageSK = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
  timestamp: string,
  messageId: string,
): string => `${buildDocumentPrefix(orgId, projectId, opportunityId, documentId)}#${timestamp}#${messageId}`;

// ─── CRUD ─────────────────────────────────────────────────────────────────────

/**
 * Save a chat message pair (user + assistant) to DynamoDB.
 */
export const saveChatMessages = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  sectionTitle: string;
  userInstruction: string;
  assistantContent: string;
  updatedHtml?: string;
  applied?: boolean;
  error?: string;
  toolRoundsUsed?: number;
  userId?: string;
}): Promise<{ userMessage: AIChatMessageItem; assistantMessage: AIChatMessageItem }> => {
  const {
    orgId, projectId, opportunityId, documentId,
    sectionTitle, userInstruction, assistantContent,
    updatedHtml, applied, error, toolRoundsUsed, userId,
  } = args;

  const now = nowIso();
  const userMessageId = uuidv4();
  const assistantMessageId = uuidv4();

  // Save user message (timestamp slightly before assistant for ordering)
  const userTimestamp = now;
  const userSK = buildMessageSK(orgId, projectId, opportunityId, documentId, userTimestamp, userMessageId);

  const userMessage = await putItem<AIChatMessageItem>(
    AI_CHAT_MESSAGE_PK,
    userSK,
    {
      messageId: userMessageId,
      documentId,
      projectId,
      opportunityId,
      orgId,
      role: 'user',
      content: userInstruction,
      sectionTitle,
      userId,
      timestamp: userTimestamp,
    },
  );

  // Save assistant message (1ms after user for consistent ordering)
  const assistantTimestamp = new Date(new Date(now).getTime() + 1).toISOString();
  const assistantSK = buildMessageSK(orgId, projectId, opportunityId, documentId, assistantTimestamp, assistantMessageId);

  const assistantMessage = await putItem<AIChatMessageItem>(
    AI_CHAT_MESSAGE_PK,
    assistantSK,
    {
      messageId: assistantMessageId,
      documentId,
      projectId,
      opportunityId,
      orgId,
      role: 'assistant',
      content: assistantContent,
      sectionTitle,
      updatedHtml,
      applied,
      error,
      toolRoundsUsed,
      userId,
      timestamp: assistantTimestamp,
    },
  );

  return { userMessage, assistantMessage };
};

/**
 * List all chat messages for a document, ordered by timestamp (ascending).
 */
export const listChatMessages = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
): Promise<AIChatMessageItem[]> => {
  const skPrefix = buildDocumentPrefix(orgId, projectId, opportunityId, documentId);
  const items = await queryBySkPrefix<AIChatMessageItem>(AI_CHAT_MESSAGE_PK, skPrefix);

  // Sort by timestamp ascending (oldest first)
  return items.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
};

/**
 * Delete all chat messages for a document.
 * Used during document deletion to clean up related data.
 */
export const deleteAllChatMessages = async (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
): Promise<{ deleted: number; failed: number }> => {
  const skPrefix = buildDocumentPrefix(orgId, projectId, opportunityId, documentId);
  return deleteAllBySkPrefix(AI_CHAT_MESSAGE_PK, skPrefix);
};
