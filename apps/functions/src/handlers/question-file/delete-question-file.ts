import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import {
  DeleteCommand,
  GetCommand,
  ScanCommand,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import middy from '@middy/core';

import { apiResponse } from '@/helpers/api';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_FILE_PK } from '@/constants/question-file';
import { withSentryLambda } from '@/sentry-lambda';
import { QUESTION_PK } from '@/constants/question';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { QuestionFileItem } from '@auto-rfp/core';
import { buildQuestionFileSK } from '@/helpers/questionFile';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const s3Client = new S3Client({});

function safeS3Key(key?: unknown): string | null {
  if (typeof key !== 'string') return null;
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return null;
  return trimmed;
}

async function deleteS3ObjectBestEffort(key: string) {
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: DOCUMENTS_BUCKET!,
        Key: key,
      }),
    );
    return { key, ok: true as const };
  } catch (err) {
    console.warn(`Failed to delete S3 object: ${key}`, err);
    return { key, ok: false as const };
  }
}

type KeyPair = { pk: string; sk: string };

async function batchDeleteItems(keys: KeyPair[]): Promise<number> {
  if (!keys.length) return 0;

  let deleted = 0;

  for (let i = 0; i < keys.length; i += 25) {
    const chunk = keys.slice(i, i + 25);

    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [DB_TABLE_NAME]: chunk.map((k) => ({
            DeleteRequest: {
              Key: {
                [PK_NAME]: k.pk,
                [SK_NAME]: k.sk,
              },
            },
          })),
        },
      }),
    );

    deleted += chunk.length;
  }

  return deleted;
}

async function scanAllQuestionKeys(projectId: string, questionFileId: string): Promise<KeyPair[]> {
  const keys: KeyPair[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new ScanCommand({
        TableName: DB_TABLE_NAME,
        ExclusiveStartKey,
        ProjectionExpression: '#pk, #sk',
        FilterExpression: '#pk = :qpk AND #projectId = :projectId AND #questionFileId = :questionFileId',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
          '#projectId': 'projectId',
          '#questionFileId': 'questionFileId',
        },
        ExpressionAttributeValues: {
          ':qpk': QUESTION_PK,
          ':projectId': projectId,
          ':questionFileId': questionFileId,
        },
      }),
    );

    const items = (res.Items ?? []) as Array<Record<string, any>>;
    for (const it of items) {
      const pk = it?.[PK_NAME];
      const sk = it?.[SK_NAME];
      if (typeof pk === 'string' && typeof sk === 'string') {
        keys.push({ pk, sk });
      }
    }

    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return keys;
}

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  try {
    const { projectId, questionFileId, oppId } = event.queryStringParameters || {};

    if (!projectId) return apiResponse(400, { message: 'projectId query param is required' });
    if (!questionFileId) return apiResponse(400, { message: 'questionFileId query param is required' });
    if (!oppId) return apiResponse(400, { message: 'oppId query param is required' });

    const sk = buildQuestionFileSK(projectId, oppId, questionFileId);

    const getRes = await docClient.send(
      new GetCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: QUESTION_FILE_PK,
          [SK_NAME]: sk,
        },
      }),
    );

    if (!getRes.Item) {
      return apiResponse(404, { message: 'Question file not found' });
    }

    const item = getRes.Item as QuestionFileItem;

    const fileKey = safeS3Key(item.fileKey);
    const textFileKey = safeS3Key(item.textFileKey);

    const keysToDelete = Array.from(new Set([fileKey, textFileKey].filter(Boolean) as string[]));
    const s3Results = keysToDelete.length
      ? await Promise.all(keysToDelete.map(deleteS3ObjectBestEffort))
      : [];

    const questionKeys = await scanAllQuestionKeys(projectId, questionFileId);
    const deletedQuestions = await batchDeleteItems(questionKeys);

    await docClient.send(
      new DeleteCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: QUESTION_FILE_PK,
          [SK_NAME]: sk,
        },
        ConditionExpression: '#pk = :pk AND #sk = :sk',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pk': QUESTION_FILE_PK,
          ':sk': sk,
        },
      }),
    );

    return apiResponse(200, {
      success: true,
      deleted: {
        projectId,
        questionFileId,
        sk,
      },
      questions: {
        matched: questionKeys.length,
        deleted: deletedQuestions,
      },
      s3: {
        bucket: DOCUMENTS_BUCKET,
        keysRequested: keysToDelete,
        results: s3Results,
      },
    });
  } catch (err: any) {
    console.error('delete-question-file error:', err);

    const name = err?.name || err?.__type;
    if (name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { message: 'Question file not found' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:delete'))
    .use(httpErrorMiddleware()),
);