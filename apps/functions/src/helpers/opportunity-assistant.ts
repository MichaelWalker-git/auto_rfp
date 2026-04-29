/**
 * DynamoDB helpers for Opportunity Assistant chat message persistence.
 *
 * PK: OPP_ASSISTANT_CHAT
 * SK: {opportunityId}#{timestamp}#{messageId}
 *
 * Query pattern: all messages for an opportunity via SK prefix.
 */
import { v4 as uuidv4 } from 'uuid';
import { TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { putItem, queryBySkPrefix, deleteAllBySkPrefix, docClient } from '@/helpers/db';
import { OPP_ASSISTANT_CHAT_PK } from '@/constants/opportunity-assistant';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { nowIso } from '@/helpers/date';
import { requireEnv } from '@/helpers/env';
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
 * Save a user + assistant message pair atomically using DynamoDB TransactWrite.
 * Both messages succeed or fail together — no dangling user messages on failure.
 */
export const saveChatMessagePair = async (args: {
  opportunityId: string;
  userMessage: string;
  assistantAnswer: string;
  sources: ChatSourceCitation[];
  userId?: string;
}): Promise<{ userMsg: ChatMessageItem; assistantMsg: ChatMessageItem }> => {
  const { opportunityId, userMessage, assistantAnswer, sources, userId } = args;
  const tableName = requireEnv('DB_TABLE_NAME');

  // Build user message
  const userTimestamp = nowIso();
  const userMessageId = uuidv4();
  const userSK = buildChatMessageSK(opportunityId, userTimestamp, userMessageId);

  const userMsg: ChatMessageItem = {
    messageId: userMessageId,
    opportunityId,
    role: 'user',
    content: userMessage,
    userId,
    createdAt: userTimestamp,
  };

  // Build assistant message (1ms later for ordering)
  const assistantTimestamp = new Date(new Date(userTimestamp).getTime() + 1).toISOString();
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

  // Atomic write: both succeed or both fail
  await docClient.send(
    new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName,
            Item: {
              [PK_NAME]: OPP_ASSISTANT_CHAT_PK,
              [SK_NAME]: userSK,
              ...userMsg,
            },
          },
        },
        {
          Put: {
            TableName: tableName,
            Item: {
              [PK_NAME]: OPP_ASSISTANT_CHAT_PK,
              [SK_NAME]: assistantSK,
              ...assistantMsg,
            },
          },
        },
      ],
    }),
  );

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
