import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

import { PK_NAME, SK_NAME } from '../constants/common';
import { KNOWLEDGE_BASE_PK } from '../constants/organization';
import { DOCUMENT_PK } from '../constants/document';
import { CreateKnowledgeBase, KnowledgeBase, KnowledgeBaseItem, CONTENT_LIBRARY_PK, DocumentItem, parseContentLibrarySK } from '@auto-rfp/core';
import { requireEnv } from './env';
import { batchDeleteItems, createItem, DBItem, docClient } from './db';
import { safeSplitAt } from './safe-string';
import { getAccessibleKBIds } from './user-kb';
import { deleteFromPinecone, deleteVectorById } from './pinecone';

const s3Client = new S3Client({});

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

// ─── Create ───

export async function createKnowledgeBase(orgId: string, data: CreateKnowledgeBase): Promise<KnowledgeBase> {
  const kbId = uuidv4();

  const knowledgeBaseItem = await createItem<KnowledgeBase>(
    KNOWLEDGE_BASE_PK,
    `${orgId}#${kbId}`,
    {
      id: kbId,
      orgId,
      name: data.name,
      description: data.description ?? undefined,
      type: data.type,
      _count: {
        questions: 0,
        documents: 0
      },
    } as any
  );

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

// ─── Delete Helpers ───

/**
 * Delete all documents in a knowledge base, including Pinecone vectors and S3 files.
 * Returns the number of documents deleted.
 */
export async function deleteAllDocumentsInKB(orgId: string, kbId: string): Promise<number> {
  const skPrefix = `KB#${kbId}#DOC#`;
  const bucketName = requireEnv('DOCUMENTS_BUCKET');

  // Query all documents in this KB (fetch full items for S3 key cleanup)
  const documents: (DocumentItem & DBItem)[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pk': DOCUMENT_PK,
          ':skPrefix': skPrefix,
        },
        ExclusiveStartKey,
      }),
    );

    if (res.Items?.length) {
      documents.push(...(res.Items as (DocumentItem & DBItem)[]));
    }

    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  if (documents.length === 0) {
    return 0;
  }

  // Clean up Pinecone vectors and S3 files for each document
  await Promise.all(
    documents.map(async (doc) => {
      const sk = doc[SK_NAME] as string;

      // Delete vectors from Pinecone
      try {
        await deleteFromPinecone(orgId, sk);
      } catch (err) {
        console.warn(`Failed to delete Pinecone vectors for SK=${sk}:`, (err as Error)?.message);
      }

      // Delete S3 files
      const s3Deletes: Promise<unknown>[] = [];
      if (doc.fileKey) {
        s3Deletes.push(
          s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: doc.fileKey })),
        );
      }
      if (doc.textFileKey) {
        s3Deletes.push(
          s3Client.send(new DeleteObjectCommand({ Bucket: bucketName, Key: doc.textFileKey })),
        );
      }
      if (s3Deletes.length > 0) {
        await Promise.all(s3Deletes).catch((err) => {
          console.warn(`Failed to delete S3 files for SK=${sk}:`, (err as Error)?.message);
        });
      }
    }),
  );

  // Delete DynamoDB records
  const keysToDelete = documents.map(doc => ({
    pk: doc[PK_NAME],
    sk: doc[SK_NAME],
  }));

  const { deleted } = await batchDeleteItems(keysToDelete);

  console.log(`Deleted ${deleted} documents (+ Pinecone vectors + S3 files) from KB ${kbId}`);
  return deleted;
}

/**
 * Delete all content library items in a knowledge base, including Pinecone vectors.
 * Uses the legacy SK format: {orgId}#{kbId}#{itemId}
 * Returns the number of items deleted.
 */
export async function deleteAllContentLibraryInKB(orgId: string, kbId: string): Promise<number> {
  const skPrefix = `${orgId}#${kbId}#`;

  const items: DBItem[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pk': CONTENT_LIBRARY_PK,
          ':skPrefix': skPrefix,
        },
        ExclusiveStartKey,
      }),
    );

    if (res.Items?.length) {
      items.push(...(res.Items as DBItem[]));
    }

    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  if (items.length === 0) {
    return 0;
  }

  // Delete Pinecone vectors for each content library item
  await Promise.all(
    items.map(async (item) => {
      const sk = item[SK_NAME] as string;
      const parsed = parseContentLibrarySK(sk);
      if (parsed) {
        try {
          await deleteVectorById(orgId, parsed.itemId);
        } catch (err) {
          console.warn(`Failed to delete Pinecone vector for content library item SK=${sk}:`, (err as Error)?.message);
        }
      }
    }),
  );

  // Delete DynamoDB records
  const keysToDelete = items.map(item => ({
    pk: item[PK_NAME],
    sk: item[SK_NAME],
  }));

  const { deleted } = await batchDeleteItems(keysToDelete);

  console.log(`Deleted ${deleted} content library items (+ Pinecone vectors) from KB ${kbId}`);
  return deleted;
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
