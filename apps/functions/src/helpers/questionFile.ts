import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { requireEnv } from './env';
import { CreateQuestionFileRequest, QuestionFileItem, } from '@auto-rfp/core';
import { createItem, DBItem, docClient } from './db';
import { nowIso } from './date';

import { v4 as uuidv4 } from 'uuid';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

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
    '#pk': PK_NAME, // For condition expression
  };
  const values: Record<string, any> = {
    ':now': nowIso()
  };

  if (status !== undefined) {
    fields.push('#status = :status');
    names['#status'] = 'status';
    values[':status'] = status;
  }

  if (textFileKey !== undefined) {
    fields.push('#textFileKey = :key');
    names['#textFileKey'] = 'textFileKey';
    values[':key'] = textFileKey;
  }

  if (jobId !== undefined) {
    fields.push('#jobId = :jobId');
    names['#jobId'] = 'jobId';
    values[':jobId'] = jobId;
  }

  if (taskToken !== undefined) {
    fields.push('#taskToken = :taskToken');
    names['#taskToken'] = 'taskToken';
    values[':taskToken'] = taskToken;
  }

  if (totalQuestions !== undefined) {
    fields.push('#totalQuestions = :totalQuestions');
    names['#totalQuestions'] = 'totalQuestions';
    values[':totalQuestions'] = totalQuestions;
  }

  if (errorMessage !== undefined) {
    fields.push('#errorMessage = :errorMessage');
    names['#errorMessage'] = 'errorMessage';
    values[':errorMessage'] = errorMessage;
  }

  if (executionArn !== undefined) {
    fields.push('#executionArn = :executionArn');
    names['#executionArn'] = 'executionArn';
    values[':executionArn'] = executionArn;
  }

  try {
    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: QUESTION_FILE_PK,
          [SK_NAME]: sk
        },
        UpdateExpression: 'SET ' + fields.join(', '),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ConditionExpression: 'attribute_exists(#pk)', // Ensures item exists
      })
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

export async function getQuestionFileItem(projectId: string, oppId: string, questionFileId: string): Promise<QuestionFileItem | null> {
  const { Item: item } = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: buildQuestionFileSK(projectId, oppId, questionFileId)
      },
      ConsistentRead: true,
    }),
  );
  return item ? item as QuestionFileItem : null;
}

export const buildQuestionFileSK = (projectId: string, oppId: string, questionFileId: string) => {
  return `${projectId}#${oppId}#${questionFileId}`;
};

export async function createQuestionFile(
  orgId: string,
  request: CreateQuestionFileRequest
): Promise<QuestionFileItem & DBItem> {
  const questionFileId = uuidv4();

  const {
    oppId,
    projectId,
    fileKey,
    originalFileName,
    mimeType,
    sourceDocumentId,
  } = request;

  const sk = buildQuestionFileSK(projectId, oppId, questionFileId);

  const item = await createItem<QuestionFileItem>(
    QUESTION_FILE_PK,
    sk,
    {
      orgId,
      projectId,
      oppId,
      questionFileId,
      fileKey,
      textFileKey: null,
      status: 'UPLOADED',
      originalFileName: originalFileName ?? null,
      mimeType: mimeType,
      sourceDocumentId: sourceDocumentId ?? null,
    } as any
  );

  return item as QuestionFileItem & DBItem;
}

export const listQuestionFilesByProject = async (args: {
  projectId: string;
  limit?: number;
  nextToken?: Record<string, any>;
}) => {
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': QUESTION_FILE_PK,
        ':skPrefix': `${args.projectId}#`,
      },
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
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': QUESTION_FILE_PK,
        ':skPrefix': skPrefix,
      },
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
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: buildQuestionFileSK(args.projectId, args.oppId, args.questionFileId),
      },
    }),
  );

  return { ok: true };
};

export async function checkQuestionFileCancelled(
  projectId: string,
  opportunityId: string,
  questionFileId: string,
): Promise<boolean> {
  const qf = await getQuestionFileItem(projectId, opportunityId, questionFileId);

  if (!qf) {
    return true;
  }

  return qf.status === 'CANCELLED';
}