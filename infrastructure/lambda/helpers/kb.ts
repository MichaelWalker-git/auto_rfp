import { PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

import { PK_NAME, SK_NAME } from '../constants/common';
import { KNOWLEDGE_BASE_PK } from '../constants/organization';
import { DOCUMENT_PK } from '../constants/document';
import { CreateKnowledgeBase, KnowledgeBase, KnowledgeBaseItem, CONTENT_LIBRARY_PK } from '@auto-rfp/shared';
import { requireEnv } from './env';
import { DBItem, docClient } from './db';
import { nowIso } from './date';
import { safeSplitAt } from './safe-string';
import { getAccessibleKBIds } from './user-kb';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// ─── Create ───

export async function createKnowledgeBase(orgId: string, data: CreateKnowledgeBase): Promise<KnowledgeBase> {
  const now = nowIso();
  const kbId = uuidv4();

  const knowledgeBaseItem = {
    [PK_NAME]: KNOWLEDGE_BASE_PK,
    [SK_NAME]: `${orgId}#${kbId}`,
    id: kbId,
    orgId,
    name: data.name,
    description: data.description ?? undefined,
    type: data.type,
    createdAt: now,
    updatedAt: now,
    _count: {
      questions: 0,
      documents: 0
    },
  } as KnowledgeBase;

  const command = new PutCommand({
    TableName: DB_TABLE_NAME,
    Item: knowledgeBaseItem,
  });

  await docClient.send(command);

  return knowledgeBaseItem;
}

// ─── List ───

/**
 * List all knowledge bases for an org, optionally filtered by user access.
 * If userId is provided and has USER_KB records, only accessible KBs are returned.
 * If userId has no USER_KB records, all org KBs are returned (backward compatible).
 */
export async function listKnowledgeBasesForOrg(
  orgId: string,
  userId?: string | null,
): Promise<KnowledgeBase[]> {
  const items: (KnowledgeBaseItem & DBItem)[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;
  const skPrefix = `${orgId}#`;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pkValue AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
        ExpressionAttributeValues: { ':pkValue': KNOWLEDGE_BASE_PK, ':skPrefix': skPrefix },
        ExclusiveStartKey,
      }),
    );
    if (res.Items?.length) {
      items.push(...(res.Items as (KnowledgeBaseItem & DBItem)[]));
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  // Build KB list with counts
  let knowledgeBases = await Promise.all(
    items.map(async (item) => {
      const sk = (item as any)[SK_NAME] as string;
      const kbId = safeSplitAt(sk, '#', 1);

      const [documentsCount, questionsCount] = await Promise.all([
        getDocumentCountForKB(kbId),
        getContentLibraryCountForKB(orgId, kbId),
      ]);

      return {
        id: kbId,
        name: item.name,
        description: item.description,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        type: item.type,
        orgId,
        _count: { questions: questionsCount, documents: documentsCount },
      } as KnowledgeBase;
    }),
  );

  // Filter by user access if applicable
  if (userId) {
    const accessibleKBIds = await getAccessibleKBIds(userId);
    if (accessibleKBIds.length > 0) {
      const accessSet = new Set(accessibleKBIds);
      knowledgeBases = knowledgeBases.filter((kb) => accessSet.has(kb.id));
    }
  }

  return knowledgeBases;
}

// ─── Count Helpers ───

async function getDocumentCountForKB(knowledgeBaseId: string): Promise<number> {
  const skPrefix = `KB#${knowledgeBaseId}`;
  let count = 0;
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pkValue AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
        ExpressionAttributeValues: { ':pkValue': DOCUMENT_PK, ':skPrefix': skPrefix },
        Select: 'COUNT',
        ExclusiveStartKey,
      }),
    );
    count += res.Count ?? 0;
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return count;
}

async function getContentLibraryCountForKB(orgId: string, knowledgeBaseId: string): Promise<number> {
  const skPrefix = `${orgId}#${knowledgeBaseId}#`;
  let count = 0;
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pkValue AND begins_with(#sk, :skPrefix)',
        FilterExpression: 'attribute_not_exists(#deprecated) OR #deprecated = :false',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME, '#deprecated': 'deprecated' },
        ExpressionAttributeValues: { ':pkValue': CONTENT_LIBRARY_PK, ':skPrefix': skPrefix, ':false': false },
        Select: 'COUNT',
        ExclusiveStartKey,
      }),
    );
    count += res.Count ?? 0;
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return count;
}
