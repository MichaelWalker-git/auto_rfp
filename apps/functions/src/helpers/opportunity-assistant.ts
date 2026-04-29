/**
 * DynamoDB helpers for Opportunity Assistant chat message persistence.
 *
 * PK: OPP_ASSISTANT_CHAT
 * SK: {opportunityId}#{timestamp}#{messageId}
 *
 * Query pattern: all messages for an opportunity via SK prefix.
 */
import { v4 as uuidv4 } from 'uuid';
import { putItem, queryBySkPrefix, deleteAllBySkPrefix } from '@/helpers/db';
import { OPP_ASSISTANT_CHAT_PK } from '@/constants/opportunity-assistant';
import { nowIso } from '@/helpers/date';
import type { ChatSourceCitation } from '@auto-rfp/core';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface ChatMessageItem {
  messageId: string;
  opportunityId: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSourceCitation[];
  userId?: string;
  createdAt: string;
}

// ─── SK Builders ───────────────────────────────────────────────────────────────

export const buildChatMessageSK = (
  opportunityId: string,
  timestamp: string,
  messageId: string,
): string => `${opportunityId}#${timestamp}#${messageId}`;

export const buildChatMessagePrefix = (opportunityId: string): string => `${opportunityId}#`;

// ─── CRUD Operations ───────────────────────────────────────────────────────────

/**
 * Save a chat message (user or assistant) to DynamoDB.
 */
export const saveChatMessage = async (args: {
  opportunityId: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: ChatSourceCitation[];
  userId?: string;
}): Promise<ChatMessageItem> => {
  const { opportunityId, role, content, sources, userId } = args;

  const now = nowIso();
  const messageId = uuidv4();
  const sk = buildChatMessageSK(opportunityId, now, messageId);

  const message: ChatMessageItem = {
    messageId,
    opportunityId,
    role,
    content,
    sources,
    userId,
    createdAt: now,
  };

  await putItem<ChatMessageItem>(OPP_ASSISTANT_CHAT_PK, sk, message);
  return message;
};

/**
 * Save a user + assistant message pair atomically.
 */
export const saveChatMessagePair = async (args: {
  opportunityId: string;
  userMessage: string;
  assistantAnswer: string;
  sources: ChatSourceCitation[];
  userId?: string;
}): Promise<{ userMsg: ChatMessageItem; assistantMsg: ChatMessageItem }> => {
  const { opportunityId, userMessage, assistantAnswer, sources, userId } = args;

  // Save user message
  const userMsg = await saveChatMessage({
    opportunityId,
    role: 'user',
    content: userMessage,
    userId,
  });

  // Save assistant message (1ms later for ordering)
  const assistantTimestamp = new Date(new Date(userMsg.createdAt).getTime() + 1).toISOString();
  const assistantMessageId = uuidv4();
  const assistantSK = buildChatMessageSK(opportunityId, assistantTimestamp, assistantMessageId);

  const assistantMsg: ChatMessageItem = {
    messageId: assistantMessageId,
    opportunityId,
    role: 'assistant',
    content: assistantAnswer,
    sources,
    userId,
    createdAt: assistantTimestamp,
  };

  await putItem<ChatMessageItem>(OPP_ASSISTANT_CHAT_PK, assistantSK, assistantMsg);

  return { userMsg, assistantMsg };
};

/**
 * List all chat messages for an opportunity, ordered by timestamp.
 */
export const listChatHistory = async (
  opportunityId: string,
): Promise<ChatMessageItem[]> => {
  const prefix = buildChatMessagePrefix(opportunityId);
  const items = await queryBySkPrefix<ChatMessageItem>(OPP_ASSISTANT_CHAT_PK, prefix);
  return items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
};

/**
 * Delete all chat history for an opportunity.
 * Called when opportunity is deleted.
 */
export const deleteChatHistory = async (
  opportunityId: string,
): Promise<{ deleted: number; failed: number }> => {
  const prefix = buildChatMessagePrefix(opportunityId);
  return deleteAllBySkPrefix(OPP_ASSISTANT_CHAT_PK, prefix);
};
