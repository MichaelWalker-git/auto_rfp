import { PutCommand, } from '@aws-sdk/lib-dynamodb';
import { v4 as uuidv4 } from 'uuid';

import { PK_NAME, SK_NAME } from '../constants/common';
import { KNOWLEDGE_BASE_PK } from '../constants/organization';
import { CreateKnowledgeBase, KnowledgeBase, } from '@auto-rfp/shared';
import { requireEnv } from './env';
import { docClient } from './db';
import { nowIso } from './date';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

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
