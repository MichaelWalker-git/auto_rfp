import { docClient } from './db';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { requireEnv } from './env';
import { nowIso } from './date';
import { QuestionFileItem, } from '@auto-rfp/shared';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export async function updateQuestionFile(
  projectId: string,
  questionFileId: string,
  questionFile: Partial<QuestionFileItem>
) {
  const { status, textFileKey, jobId, taskToken, totalQuestions } = questionFile;
  const sk = `${projectId}#${questionFileId}`;

  const fields: string[] = ['#status = :status', '#updatedAt = :now'];
  const names: Record<string, string> = {
    '#status': 'status',
    '#updatedAt': 'updatedAt'
  };
  const values: Record<string, any> = {
    ':status': status,
    ':now': nowIso()
  };

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
    values[':taskToken'] = jobId;
  }


  if (totalQuestions) {
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

export async function getQuestionFileItem(projectId: string, questionFileId: string): Promise<QuestionFileItem | null> {
  const { Item: item } = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_FILE_PK,
        [SK_NAME]: `${projectId}#${questionFileId}`,
      },
      ConsistentRead: true,
    }),
  );
  return item ? item as QuestionFileItem : null;
}