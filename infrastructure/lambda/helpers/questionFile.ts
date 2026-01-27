import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { requireEnv } from './env';
import { CreateQuestionFileRequest, QuestionFileItem, } from '@auto-rfp/shared';
import { DBItem, docClient } from './db';
import { nowIso } from './date';

import { v4 as uuidv4 } from 'uuid';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export async function updateQuestionFile(
  projectId: string,
  oppId: string,
  questionFileId: string,
  questionFile: Partial<QuestionFileItem>
) {
  const { status, textFileKey, jobId, taskToken, totalQuestions } = questionFile;
  const sk = buildQuestionFileSK(projectId, oppId, questionFileId);

  const fields: string[] = ['#updatedAt = :now'];
  const names: Record<string, string> = {
    '#updatedAt': 'updatedAt'
  };
  const values: Record<string, any> = {
    ':now': nowIso()
  };

  if (status !== undefined) {
    fields.push('#status = :status');
    names['#status'] = 'status';
    values[':status'] = status;
  }

  if (textFileKey) {
    fields.push('#textFileKey = :key');
    names['#textFileKey'] = 'textFileKey';
    values[':key'] = textFileKey;
  }

  if (jobId) {
    fields.push('#jobId = :jobId');
    names['#jobId'] = 'jobId';
    values[':jobId'] = jobId;
  }

  if (taskToken) {
    fields.push('#taskToken = :taskToken');
    names['#taskToken'] = 'taskToken';
    values[':taskToken'] = taskToken;
  }

  if (totalQuestions !== undefined) {
    fields.push('#totalQuestions = :totalQuestions');
    names['#totalQuestions'] = 'totalQuestions';
    values[':totalQuestions'] = totalQuestions;
  }

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: sk
      },
      UpdateExpression: 'SET ' + fields.join(', '),
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values
    })
  );
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

  const item: QuestionFileItem & DBItem = {
    [PK_NAME]: QUESTION_FILE_PK,
    [SK_NAME]: sk,
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

    createdAt: nowIso(),
    updatedAt: nowIso(),
  };

  await docClient.send(
    new PutCommand({
      TableName: DB_TABLE_NAME,
      Item: item,
    }),
  );

  return item;
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