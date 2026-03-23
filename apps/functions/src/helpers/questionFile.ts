import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { QUESTION_PK } from '../constants/question';
import { BatchWriteCommand, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { requireEnv } from './env';
import { CreateQuestionFileRequest, QuestionFileItem, ReextractQuestions, ReextractAllQuestions } from '@auto-rfp/core';
import { createItem, DBItem, deleteItem, docClient, queryAllBySkPrefix } from './db';
import { buildQuestionSK } from './question';
import { ANSWER_PK } from '../constants/answer';
import { QUESTION_CLUSTER_PK } from '../constants/clustering';
import { startPipeline } from './solicitation';
import { nowIso } from './date';
import { v4 as uuidv4 } from 'uuid';

// Resolved lazily so tests can set process.env before module-level code runs
const getTableName = () => requireEnv('DB_TABLE_NAME');
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');

export async function updateQuestionFile(
  projectId: string,
  oppId: string,
  questionFileId: string,
  questionFile: Partial<QuestionFileItem>
): Promise<{ success: boolean; deleted?: boolean }> {
  const { status, textFileKey, jobId, taskToken, totalQuestions, errorMessage, executionArn } = questionFile;
  const sk = buildQuestionFileSK(projectId, oppId, questionFileId);

  const fields: string[] = ['#updatedAt = :now'];
  const names: Record<string, string> = {
    '#updatedAt': 'updatedAt',
    '#pk': PK_NAME,
  };
  const values: Record<string, any> = {
    ':now': nowIso(),
  };

  if (status !== undefined) { fields.push('#status = :status'); names['#status'] = 'status'; values[':status'] = status; }
  if (textFileKey !== undefined) { fields.push('#textFileKey = :key'); names['#textFileKey'] = 'textFileKey'; values[':key'] = textFileKey; }
  if (jobId !== undefined) { fields.push('#jobId = :jobId'); names['#jobId'] = 'jobId'; values[':jobId'] = jobId; }
  if (taskToken !== undefined) { fields.push('#taskToken = :taskToken'); names['#taskToken'] = 'taskToken'; values[':taskToken'] = taskToken; }
  if (totalQuestions !== undefined) { fields.push('#totalQuestions = :totalQuestions'); names['#totalQuestions'] = 'totalQuestions'; values[':totalQuestions'] = totalQuestions; }
  if (errorMessage !== undefined) { fields.push('#errorMessage = :errorMessage'); names['#errorMessage'] = 'errorMessage'; values[':errorMessage'] = errorMessage; }
  if (executionArn !== undefined) { fields.push('#executionArn = :executionArn'); names['#executionArn'] = 'executionArn'; values[':executionArn'] = executionArn; }

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: getTableName(),
        Key: { [PK_NAME]: QUESTION_FILE_PK, [SK_NAME]: sk },
        UpdateExpression: 'SET ' + fields.join(', '),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(#pk)',
      }),
    );
    return { success: true };
  } catch (err: any) {
    if (err.name === 'ConditionalCheckFailedException') {
      console.log(`Question file not found (likely deleted): ${questionFileId}`);
      return { success: false, deleted: true };
    }
    throw err;
  }
}

export const getQuestionFileItem = async (
  projectId: string,
  oppId: string,
  questionFileId: string,
): Promise<QuestionFileItem | null> => {
  const { Item: item } = await docClient.send(
    new GetCommand({
      TableName: getTableName(),
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: buildQuestionFileSK(projectId, oppId, questionFileId),
      },
      ConsistentRead: true,
    }),
  );
  return item ? (item as QuestionFileItem) : null;
};

export const buildQuestionFileSK = (projectId: string, oppId: string, questionFileId: string): string =>
  `${projectId}#${oppId}#${questionFileId}`;

export const createQuestionFile = async (
  request: CreateQuestionFileRequest,
): Promise<QuestionFileItem & DBItem> => {
  const questionFileId = uuidv4();
  const { orgId, oppId, projectId, fileKey, originalFileName, mimeType, sourceDocumentId, fileSize } = request;
  const sk = buildQuestionFileSK(projectId, oppId, questionFileId);

  const item = await createItem<QuestionFileItem>(QUESTION_FILE_PK, sk, {
    orgId,
    projectId,
    oppId,
    questionFileId,
    fileKey,
    textFileKey: null,
    status: 'UPLOADED',
    originalFileName: originalFileName ?? null,
    mimeType,
    sourceDocumentId: sourceDocumentId ?? null,
    ...(fileSize !== undefined ? { fileSize } : {}),
  } as any);

  return item as QuestionFileItem & DBItem;
};

export const listQuestionFilesByProject = async (args: {
  projectId: string;
  limit?: number;
  nextToken?: Record<string, any>;
}) => {
  const res = await docClient.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
      ExpressionAttributeValues: { ':pk': QUESTION_FILE_PK, ':skPrefix': `${args.projectId}#` },
      Limit: args.limit,
      ExclusiveStartKey: args.nextToken,
      ScanIndexForward: false,
    }),
  );
  return {
    items: (res.Items ?? []) as any[],
    nextToken: (res.LastEvaluatedKey ?? null) as Record<string, any> | null,
  };
};

export const listQuestionFilesByOpportunity = async (args: {
  projectId: string;
  oppId: string;
  limit?: number;
  nextToken?: Record<string, any>;
}) => {
  const skPrefix = buildQuestionFileSK(args.projectId, args.oppId, '');
  const res = await docClient.send(
    new QueryCommand({
      TableName: getTableName(),
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
      ExpressionAttributeValues: { ':pk': QUESTION_FILE_PK, ':skPrefix': skPrefix },
      Limit: args.limit,
      ExclusiveStartKey: args.nextToken,
      ScanIndexForward: false,
    }),
  );
  return {
    items: (res.Items ?? []) as any[],
    nextToken: (res.LastEvaluatedKey ?? null) as Record<string, any> | null,
  };
};

export const deleteQuestionFile = async (args: {
  projectId: string;
  oppId: string;
  questionFileId: string;
}) => {
  const { DeleteCommand } = await import('@aws-sdk/lib-dynamodb');
  await docClient.send(
    new DeleteCommand({
      TableName: getTableName(),
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: buildQuestionFileSK(args.projectId, args.oppId, args.questionFileId),
      },
    }),
  );
  return { ok: true };
};

// ─── S3 + cascade delete helpers ─────────────────────────────────────────────

const s3Client = new S3Client({});

const deleteS3ObjectBestEffort = async (
  bucket: string,
  key: string,
): Promise<{ key: string; ok: boolean }> => {
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return { key, ok: true };
  } catch (err) {
    console.warn(`Failed to delete S3 object: ${key}`, err);
    return { key, ok: false };
  }
};

/**
 * Query all question keys for a given projectId + oppId + questionFileId
 * using begins_with on the SK: {projectId}#{oppId}#{questionFileId}#
 */
const queryQuestionKeysByFile = async (
  projectId: string,
  oppId: string,
  questionFileId: string,
): Promise<Array<{ pk: string; sk: string }>> => {
  const skPrefix = buildQuestionSK(projectId, oppId, questionFileId, '');
  const items = await queryAllBySkPrefix<{ partition_key: string; sort_key: string }>(
    QUESTION_PK,
    skPrefix,
  );
  return items.map((item) => ({ pk: item[PK_NAME], sk: item[SK_NAME] }));
};

const batchDeleteDynamoItems = async (
  items: Array<{ pk: string; sk: string }>,
): Promise<number> => {
  if (!items.length) return 0;
  let deleted = 0;
  for (let i = 0; i < items.length; i += 25) {
    const chunk = items.slice(i, i + 25);
    await docClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [getTableName()]: chunk.map((k) => ({
            DeleteRequest: { Key: { [PK_NAME]: k.pk, [SK_NAME]: k.sk } },
          })),
        },
      }),
    );
    deleted += chunk.length;
  }
  return deleted;
};

export interface DeleteQuestionFileResult {
  questionFileId: string;
  sk: string;
  questionsDeleted: number;
  s3: {
    bucket: string;
    keysRequested: string[];
    results: Array<{ key: string; ok: boolean }>;
  };
}

/**
 * Delete a question file record, cascade-delete all associated questions,
 * and best-effort delete S3 objects.
 * Returns null if the question file does not exist.
 */
export const deleteQuestionFileWithCascade = async (
  projectId: string,
  oppId: string,
  questionFileId: string,
): Promise<DeleteQuestionFileResult | null> => {
  const documentsBucket = getDocumentsBucket();
  const sk = buildQuestionFileSK(projectId, oppId, questionFileId);

  const { Item: item } = await docClient.send(
    new GetCommand({
      TableName: getTableName(),
      Key: { [PK_NAME]: QUESTION_FILE_PK, [SK_NAME]: sk },
    }),
  );

  if (!item) return null;

  const qf = item as QuestionFileItem;

  // 1. Delete S3 objects (best-effort)
  const toS3Key = (v: unknown): string | null => {
    if (typeof v !== 'string') return null;
    const t = v.trim();
    return t && !t.startsWith('http://') && !t.startsWith('https://') ? t : null;
  };
  const keysToDelete = Array.from(
    new Set([toS3Key(qf.fileKey), toS3Key(qf.textFileKey)].filter(Boolean) as string[]),
  );
  const s3Results = keysToDelete.length
    ? await Promise.all(keysToDelete.map((k) => deleteS3ObjectBestEffort(documentsBucket, k)))
    : [];

  // 2. Cascade delete associated questions
  const questionKeys = await queryQuestionKeysByFile(projectId, oppId, questionFileId);
  const questionsDeleted = await batchDeleteDynamoItems(questionKeys);

  // 3. Delete the question file record itself
  await deleteItem(QUESTION_FILE_PK, sk);

  return {
    questionFileId,
    sk,
    questionsDeleted,
    s3: {
      bucket: documentsBucket,
      keysRequested: keysToDelete,
      results: s3Results,
    },
  };
};

export interface ReextractQuestionsResult {
  deletedCount: number;
  executionArn?: string;
  startDate?: Date;
}

/**
 * Delete all questions (and their answers) extracted from a question file,
 * reset the file status to UPLOADED, and restart the pipeline.
 * Returns null if the question file does not exist.
 */
export const reextractQuestions = async (
  dto: ReextractQuestions,
): Promise<ReextractQuestionsResult | null> => {
  const { projectId, oppId, questionFileId } = dto;

  const qf = await getQuestionFileItem(projectId, oppId, questionFileId);
  if (!qf) return null;

  // 1. Delete all questions (and their answers) for this file
  const skPrefix = buildQuestionSK(projectId, oppId, questionFileId, '');
  const questionItems = await queryAllBySkPrefix<{ partition_key: string; sort_key: string; questionId?: string }>(
    QUESTION_PK,
    skPrefix,
  );

  for (const item of questionItems) {
    // Delete the associated answer (same SK pattern)
    const answerSk = buildQuestionSK(projectId, oppId, questionFileId, item.questionId ?? item.sort_key.split('#').pop() ?? '');
    try {
      await deleteItem(ANSWER_PK, answerSk);
    } catch {
      // Answer may not exist — not an error
    }
    await deleteItem(QUESTION_PK, item.sort_key);
  }

  const deletedCount = questionItems.length;

  // 2. Reset question file status to UPLOADED and clear any previous error
  await updateQuestionFile(projectId, oppId, questionFileId, {
    status: 'UPLOADED',
    totalQuestions: 0,
    errorMessage: '',
    executionArn: undefined,
  });

  // 3. Start the pipeline
  const { executionArn, startDate } = await startPipeline(
    projectId,
    oppId,
    questionFileId,
    qf.fileKey,
    qf.mimeType,
  );

  // 4. Update status to PROCESSING
  await updateQuestionFile(projectId, oppId, questionFileId, {
    status: 'PROCESSING',
    executionArn,
  });

  return { deletedCount, executionArn, startDate };
};

export const checkQuestionFileCancelled = async (
  projectId: string,
  opportunityId: string,
  questionFileId: string,
): Promise<boolean> => {
  const qf = await getQuestionFileItem(projectId, opportunityId, questionFileId);
  return !qf || qf.status === 'CANCELLED';
};

// ─── Re-extract All Questions for an Opportunity ─────────────────────────────

export interface ReextractAllQuestionsResult {
  questionsDeleted: number;
  answersDeleted: number;
  clustersDeleted: number;
  filesProcessed: number;
  pipelinesStarted: Array<{
    questionFileId: string;
    executionArn?: string;
  }>;
}

/**
 * Delete ALL questions, answers, and clusters for an opportunity,
 * reset all question files to UPLOADED, and restart the pipeline for each file.
 */
export const reextractAllQuestions = async (
  dto: ReextractAllQuestions,
): Promise<ReextractAllQuestionsResult> => {
  const { projectId, oppId } = dto;

  // 1. Get all question files for this opportunity
  const { items: questionFiles } = await listQuestionFilesByOpportunity({ projectId, oppId });
  const validFiles = (questionFiles as QuestionFileItem[]).filter(
    (qf) => qf.questionFileId && qf.status !== 'DELETED' && qf.status !== 'CANCELLED',
  );

  // 2. Delete all questions for this opportunity (across all files)
  //    SK pattern: {projectId}#{oppId}#
  const questionSkPrefix = `${projectId}#${oppId}#`;
  const allQuestions = await queryAllBySkPrefix<{ partition_key: string; sort_key: string }>(
    QUESTION_PK,
    questionSkPrefix,
  );
  const questionsDeleted = await batchDeleteDynamoItems(
    allQuestions.map((item) => ({ pk: item[PK_NAME], sk: item[SK_NAME] })),
  );

  // 3. Delete all answers for this opportunity (same SK prefix pattern)
  const allAnswers = await queryAllBySkPrefix<{ partition_key: string; sort_key: string }>(
    ANSWER_PK,
    questionSkPrefix,
  );
  const answersDeleted = await batchDeleteDynamoItems(
    allAnswers.map((item) => ({ pk: item[PK_NAME], sk: item[SK_NAME] })),
  );

  // 4. Delete all clusters for this project
  //    Cluster SK pattern: {projectId}#{clusterId}
  //    We filter by opportunityId field since clusters store it as a property
  const allClusters = await queryAllBySkPrefix<{ partition_key: string; sort_key: string; opportunityId?: string }>(
    QUESTION_CLUSTER_PK,
    `${projectId}#`,
  );
  const opportunityClusters = allClusters.filter(
    (c) => c.opportunityId === oppId,
  );
  const clustersDeleted = await batchDeleteDynamoItems(
    opportunityClusters.map((item) => ({ pk: item[PK_NAME], sk: item[SK_NAME] })),
  );

  // 5. Reset each question file and restart pipelines
  const pipelinesStarted: ReextractAllQuestionsResult['pipelinesStarted'] = [];

  for (const qf of validFiles) {
    // Reset question file status to UPLOADED
    await updateQuestionFile(projectId, oppId, qf.questionFileId, {
      status: 'UPLOADED',
      totalQuestions: 0,
      errorMessage: '',
      executionArn: undefined,
    });

    // Start the pipeline
    try {
      const { executionArn } = await startPipeline(
        projectId,
        oppId,
        qf.questionFileId,
        qf.fileKey,
        qf.mimeType,
      );

      // Update status to PROCESSING
      await updateQuestionFile(projectId, oppId, qf.questionFileId, {
        status: 'PROCESSING',
        executionArn,
      });

      pipelinesStarted.push({ questionFileId: qf.questionFileId, executionArn });
    } catch (err) {
      console.error(`Failed to start pipeline for question file ${qf.questionFileId}:`, err);
      await updateQuestionFile(projectId, oppId, qf.questionFileId, {
        status: 'FAILED',
        errorMessage: err instanceof Error ? err.message : 'Failed to start pipeline',
      });
      pipelinesStarted.push({ questionFileId: qf.questionFileId });
    }
  }

  return {
    questionsDeleted,
    answersDeleted,
    clustersDeleted,
    filesProcessed: validFiles.length,
    pipelinesStarted,
  };
};
