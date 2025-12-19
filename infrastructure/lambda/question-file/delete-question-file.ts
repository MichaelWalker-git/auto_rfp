import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, } from '@aws-sdk/lib-dynamodb';

import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { apiResponse } from '../helpers/api';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { withSentryLambda } from '../sentry-lambda';
import { EXEC_BRIEF_PK } from '../constants/exec-brief';

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
const DOCUMENTS_BUCKET_NAME = process.env.DOCUMENTS_BUCKET_NAME || process.env.DOCUMENTS_BUCKET;

if (!DB_TABLE_NAME) throw new Error('DB_TABLE_NAME env var is not set');
if (!DOCUMENTS_BUCKET_NAME)
  throw new Error(
    'DOCUMENTS_BUCKET_NAME (or DOCUMENTS_BUCKET) env var is not set',
  );

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const s3Client = new S3Client({});

function safeS3Key(key?: unknown): string | null {
  if (typeof key !== 'string') return null;
  const trimmed = key.trim();
  if (!trimmed) return null;

  // defensive: avoid accidentally deleting by URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return null;

  return trimmed;
}

async function deleteS3ObjectBestEffort(key: string) {
  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: DOCUMENTS_BUCKET_NAME!,
        Key: key,
      }),
    );
    return { key, ok: true as const };
  } catch (err) {
    console.warn(`Failed to delete S3 object: ${key}`, err);
    return { key, ok: false as const };
  }
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const { projectId, questionFileId } = event.queryStringParameters || {};

    if (!projectId)
      return apiResponse(400, { message: 'projectId query param is required' });
    if (!questionFileId)
      return apiResponse(400, {
        message: 'questionFileId query param is required',
      });

    const sk = `${projectId}#${questionFileId}`;

    // 1) Load row to obtain S3 keys
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

    const item = getRes.Item as Record<string, any>;

    // keys we want to remove from S3
    const fileKey = safeS3Key(item.fileKey);
    const textFileKey = safeS3Key(item.textFileKey);

    const keysToDelete = Array.from(
      new Set([fileKey, textFileKey].filter(Boolean) as string[]),
    );

    // 2) Delete S3 objects (best-effort)
    const s3Results = keysToDelete.length
      ? await Promise.all(keysToDelete.map(deleteS3ObjectBestEffort))
      : [];

    // 3) Delete Dynamo row
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

    if (item?.executiveBriefId) {
      await docClient.send(
        new DeleteCommand({
          TableName: DB_TABLE_NAME,
          Key: {
            [PK_NAME]: EXEC_BRIEF_PK,
            [SK_NAME]: item.executiveBriefId,
          },
          ConditionExpression: '#pk = :pk AND #sk = :sk',
          ExpressionAttributeNames: {
            '#pk': PK_NAME,
            '#sk': SK_NAME,
          },
          ExpressionAttributeValues: {
            ':pk': EXEC_BRIEF_PK,
            ':sk': item.executiveBriefId,
          },
        }),
      );
    }

    return apiResponse(200, {
      success: true,
      deleted: {
        projectId,
        questionFileId,
        sk,
      },
      s3: {
        bucket: DOCUMENTS_BUCKET_NAME,
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

export const handler = withSentryLambda(baseHandler);
