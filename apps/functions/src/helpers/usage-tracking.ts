import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { docClient } from './db';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '../constants/common';
import { CONTENT_LIBRARY_PK, createContentLibrarySK } from '@auto-rfp/core';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENT_PK = 'DOCUMENT';

/**
 * Track usage of a content library item.
 * Increments usageCount, updates lastUsedAt, and optionally adds projectId to usedInProjectIds.
 */
export async function trackContentLibraryUsage(
  orgId: string,
  kbId: string,
  itemId: string,
  projectId?: string,
): Promise<void> {
  const sk = createContentLibrarySK(orgId, kbId, itemId);
  const now = new Date().toISOString();

  try {
    const updateExpr = projectId
      ? 'SET usageCount = if_not_exists(usageCount, :zero) + :one, lastUsedAt = :now ADD usedInProjectIds :projectSet'
      : 'SET usageCount = if_not_exists(usageCount, :zero) + :one, lastUsedAt = :now';

    const exprValues: Record<string, unknown> = {
      ':zero': 0,
      ':one': 1,
      ':now': now,
    };

    if (projectId) {
      exprValues[':projectSet'] = new Set([projectId]);
    }

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { [PK_NAME]: CONTENT_LIBRARY_PK, [SK_NAME]: sk },
        UpdateExpression: updateExpr,
        ExpressionAttributeValues: exprValues,
      }),
    );
  } catch (err) {
    // Non-critical — don't fail the parent operation
    console.warn('Failed to track content library usage:', err);
  }
}

/**
 * Track usage of a KB document (when its chunks are used in answer generation).
 * Updates lastUsedAt on the document record.
 */
export async function trackDocumentUsage(
  knowledgeBaseId: string,
  documentId: string,
): Promise<void> {
  const sk = `KB#${knowledgeBaseId}#DOC#${documentId}`;
  const now = new Date().toISOString();

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { [PK_NAME]: DOCUMENT_PK, [SK_NAME]: sk },
        UpdateExpression: 'SET lastUsedAt = :now',
        ExpressionAttributeValues: { ':now': now },
      }),
    );
  } catch (err) {
    // Non-critical — don't fail the parent operation
    console.warn('Failed to track document usage:', err);
  }
}

/**
 * Track usage for all document sources used in an answer generation.
 * Extracts unique document IDs from answer sources and updates each.
 */
export async function trackAnswerSourcesUsage(
  sources: Array<{ documentId?: string; knowledgeBaseId?: string }>,
): Promise<void> {
  const seen = new Set<string>();

  for (const source of sources) {
    if (!source.documentId) continue;
    const key = `${source.knowledgeBaseId || ''}#${source.documentId}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (source.knowledgeBaseId) {
      await trackDocumentUsage(source.knowledgeBaseId, source.documentId);
    }
  }
}
