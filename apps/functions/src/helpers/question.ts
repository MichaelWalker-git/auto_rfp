import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_PK } from '../constants/question';
import { QuestionItemDynamo } from '../handlers/answer/generate-answer';
import { requireEnv } from './env';
import { GetCommand, } from '@aws-sdk/lib-dynamodb';
import { docClient } from './db';
import crypto from 'crypto';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export async function getQuestionItemById(
  projectId: string,
  questionId: string,
): Promise<QuestionItemDynamo> {
  const res = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: QUESTION_PK,
        [SK_NAME]: buildQuestionSK(projectId, questionId),
      },
    }),
  );

  if (!res.Item) {
    throw new Error(`Question not found for PK=${QUESTION_PK}, SK=${questionId}`);
  }

  const item = res.Item as QuestionItemDynamo;

  if (!item.question) {
    throw new Error(`Question item for SK=${questionId} has no "question" field`);
  }

  return item;
}

export function normalizeQuestionText(s: string): string {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

export function isConditionalCheckFailed(err: any): boolean {
  const name = err?.name ?? err?.code;
  return name === 'ConditionalCheckFailedException';
}

export const buildQuestionSK = (projectId: string, questionId: string) => {
  return `${projectId}#${questionId}`;
};