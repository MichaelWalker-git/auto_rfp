import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { AnswerItem } from '@auto-rfp/core';
import { docClient, DBItem } from './db';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '../constants/common';
import { ANSWER_PK } from '../constants/answer';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export async function getAnswerForQuestion(projectId: string, questionId: string): Promise<(AnswerItem & DBItem) | null> {
  const skPrefix = `${projectId}#${questionId}#`;

  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': ANSWER_PK,
        ':skPrefix': skPrefix,
      },
      Limit: 1,
    }),
  );

  return (res.Items?.[0] as (AnswerItem & DBItem) | undefined) ?? null;
}

export async function hasAnswer(projectId: string, questionId: string): Promise<boolean> {
  const answer = await getAnswerForQuestion(projectId, questionId);
  return !!(answer && answer.text);
}