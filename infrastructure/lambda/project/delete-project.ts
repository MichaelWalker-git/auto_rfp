import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, QueryCommand, ScanCommand, } from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { PK_NAME, SK_NAME } from '../constants/common';
import { PROJECT_PK } from '../constants/organization';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { QUESTION_PK } from '../constants/question';
import { ANSWER_PK } from '../constants/answer';
import { EXEC_BRIEF_PK } from '../constants/exec-brief';
import { PROPOSAL_PK } from '../constants/proposal';

import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const s3Client = new S3Client({});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
if (!DB_TABLE_NAME) throw new Error('DB_TABLE_NAME environment variable is not set');

const DOCUMENTS_BUCKET_NAME =
  process.env.DOCUMENTS_BUCKET_NAME || process.env.DOCUMENTS_BUCKET || '';

type DdbKey = { [PK_NAME]: string; [SK_NAME]: string };

function safeS3Key(key?: unknown): string | null {
  if (typeof key !== 'string') return null;
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return null;
  return trimmed;
}

async function deleteS3ObjectBestEffort(key: string) {
  if (!DOCUMENTS_BUCKET_NAME) return { key, ok: false as const, skipped: true as const };

  try {
    await s3Client.send(
      new DeleteObjectCommand({
        Bucket: DOCUMENTS_BUCKET_NAME,
        Key: key,
      }),
    );
    return { key, ok: true as const };
  } catch (err) {
    console.warn(`Failed to delete S3 object: ${key}`, err);
    return { key, ok: false as const };
  }
}

async function queryKeysByPkAndSkPrefix(pk: string, skPrefix: string): Promise<DdbKey[]> {
  const keys: DdbKey[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME!,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pk': pk,
          ':skPrefix': skPrefix,
        },
        ProjectionExpression: '#pk, #sk',
        ExclusiveStartKey,
        Limit: 250,
      }),
    );

    for (const item of res.Items ?? []) {
      keys.push({
        [PK_NAME]: item[PK_NAME],
        [SK_NAME]: item[SK_NAME],
      });
    }

    ExclusiveStartKey = res.LastEvaluatedKey as any;
  } while (ExclusiveStartKey);

  return keys;
}

async function deleteKeys(keys: DdbKey[]): Promise<number> {
  if (!keys.length) return 0;

  const CONCURRENCY = 25;
  let deleted = 0;

  for (let i = 0; i < keys.length; i += CONCURRENCY) {
    const slice = keys.slice(i, i + CONCURRENCY);
    await Promise.all(
      slice.map(async (k) => {
        await docClient.send(
          new DeleteCommand({
            TableName: DB_TABLE_NAME!,
            Key: {
              [PK_NAME]: k[PK_NAME],
              [SK_NAME]: k[SK_NAME],
            },
          }),
        );
        deleted += 1;
      }),
    );
  }

  return deleted;
}

async function deleteExecutiveBriefByIdBestEffort(executiveBriefId?: unknown): Promise<boolean> {
  if (typeof executiveBriefId !== 'string' || !executiveBriefId.trim()) return false;

  try {
    await docClient.send(
      new DeleteCommand({
        TableName: DB_TABLE_NAME!,
        Key: {
          [PK_NAME]: EXEC_BRIEF_PK,
          [SK_NAME]: executiveBriefId,
        },
      }),
    );
    return true;
  } catch (e) {
    console.warn('Failed to delete executive brief best-effort:', executiveBriefId, e);
    return false;
  }
}

async function scanExecutiveBriefsByProjectId(projectId: string): Promise<DdbKey[]> {
  // Fallback only. Exec briefs are keyed by random UUID SK, so Query is not possible.
  // This assumes briefs store attribute "projectId" (they do in your init code).
  const keys: DdbKey[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new ScanCommand({
        TableName: DB_TABLE_NAME!,
        FilterExpression: '#pk = :pk AND #projectId = :projectId',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#projectId': 'projectId',
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pk': EXEC_BRIEF_PK,
          ':projectId': projectId,
        },
        ProjectionExpression: '#pk, #sk',
        ExclusiveStartKey,
        Limit: 250,
      }),
    );

    for (const item of res.Items ?? []) {
      keys.push({
        [PK_NAME]: item[PK_NAME],
        [SK_NAME]: item[SK_NAME],
      });
    }

    ExclusiveStartKey = res.LastEvaluatedKey as any;
  } while (ExclusiveStartKey);

  return keys;
}

export async function deleteProjectWithCleanup(orgId: string, projectId: string) {
  // Load project first (so we can delete executiveBriefId pointer, etc.)
  const projectKey = {
    [PK_NAME]: PROJECT_PK,
    [SK_NAME]: `${orgId}#${projectId}`,
  };

  const projectRes = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME!,
      Key: projectKey,
    }),
  );

  if (!projectRes.Item) {
    const err: any = new Error('Project not found');
    err.name = 'ConditionalCheckFailedException';
    throw err;
  }

  const projectItem = projectRes.Item as Record<string, any>;

  // 1) QUESTION_FILE cleanup (and best-effort S3 deletes)
  // Keys: PK=QUESTION_FILE_PK, SK begins_with `${projectId}#`
  const qfQueryRes = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME!,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': QUESTION_FILE_PK,
        ':skPrefix': `${projectId}#`,
      },
      // We want these attrs for cleanup
      ProjectionExpression:
        '#pk, #sk, questionFileId, projectId, fileKey, textFileKey, executiveBriefId',
    }),
  );

  const qfItems = (qfQueryRes.Items ?? []) as Array<Record<string, any>>;
  const qfKeys: DdbKey[] = qfItems.map((it) => ({
    [PK_NAME]: it[PK_NAME],
    [SK_NAME]: it[SK_NAME],
  }));

  // Collect S3 keys from question files
  const s3Keys = new Set<string>();
  const execBriefIdsFromQf = new Set<string>();

  for (const it of qfItems) {
    const fk = safeS3Key(it.fileKey);
    const tk = safeS3Key(it.textFileKey);
    if (fk) s3Keys.add(fk);
    if (tk) s3Keys.add(tk);

    if (typeof it.executiveBriefId === 'string' && it.executiveBriefId.trim()) {
      execBriefIdsFromQf.add(it.executiveBriefId.trim());
    }
  }

  const s3DeleteResults = s3Keys.size
    ? await Promise.all(Array.from(s3Keys).map(deleteS3ObjectBestEffort))
    : [];

  const questionFilesDeleted = await deleteKeys(qfKeys);

  // 2) QUESTION delete (Query by projectId prefix)
  const questionKeys = await queryKeysByPkAndSkPrefix(QUESTION_PK, `${projectId}#`);
  const questionsDeleted = await deleteKeys(questionKeys);

  // 3) ANSWER delete (Query by projectId prefix)
  // Your createAnswer SK: `${projectId}#${questionId}#${answerId}`
  const answerKeys = await queryKeysByPkAndSkPrefix(ANSWER_PK, `${projectId}#`);
  const answersDeleted = await deleteKeys(answerKeys);

  // 4) PROPOSAL delete (direct key)
  const proposalSk = `${projectId}#PROPOSAL`;
  let proposalDeleted = false;
  try {
    await docClient.send(
      new DeleteCommand({
        TableName: DB_TABLE_NAME!,
        Key: {
          [PK_NAME]: PROPOSAL_PK,
          [SK_NAME]: proposalSk,
        },
      }),
    );
    proposalDeleted = true;
  } catch (e) {
    console.warn('Failed to delete proposal best-effort:', e);
  }

  // 5) EXECUTIVE_BRIEF delete
  // Primary: delete by project.executiveBriefId + any ids found on question files
  const execBriefIds = new Set<string>();

  if (typeof projectItem.executiveBriefId === 'string' && projectItem.executiveBriefId.trim()) {
    execBriefIds.add(projectItem.executiveBriefId.trim());
  }
  for (const id of execBriefIdsFromQf) execBriefIds.add(id);

  const execBriefDeleteResults = await Promise.all(
    Array.from(execBriefIds).map((id) => deleteExecutiveBriefByIdBestEffort(id)),
  );

  // Fallback: scan for any leftover exec briefs by projectId (optional, safe)
  const scannedExecBriefKeys = await scanExecutiveBriefsByProjectId(projectId);
  const scannedExecBriefsDeleted = await deleteKeys(scannedExecBriefKeys);

  const executiveBriefsDeleted =
    execBriefDeleteResults.filter(Boolean).length + scannedExecBriefsDeleted;

  // 6) Finally delete PROJECT row (conditioned)
  await docClient.send(
    new DeleteCommand({
      TableName: DB_TABLE_NAME!,
      Key: projectKey,
      ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
    }),
  );

  return {
    questionFilesDeleted,
    questionsDeleted,
    answersDeleted,
    proposalDeleted,
    executiveBriefsDeleted,
    s3: {
      bucket: DOCUMENTS_BUCKET_NAME || null,
      keysRequested: Array.from(s3Keys),
      results: s3DeleteResults,
    },
  };
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const projectId = event.pathParameters?.projectId || event.pathParameters?.id;
    const { orgId } = event.queryStringParameters || {};

    if (!orgId || !projectId) {
      return apiResponse(400, {
        message: 'Missing required query parameters: orgId and projectId',
      });
    }

    const cleanup = await deleteProjectWithCleanup(orgId, projectId);

    return apiResponse(200, {
      success: true,
      message: 'Project deleted successfully (with cleanup)',
      orgId,
      projectId,
      cleanup,
    });
  } catch (err: any) {
    console.error('Error in deleteProject handler:', err);

    if (err?.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { message: 'Project not found' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);