import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_PK } from '../constants/question';
import { QuestionItemDynamo } from '../answer/generate-answer';
import { requireEnv } from './env';
import { DynamoDBDocumentClient, GetCommand, } from '@aws-sdk/lib-dynamodb';
import { docClient } from './db';

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
        [SK_NAME]: `${projectId}#${questionId}`,
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