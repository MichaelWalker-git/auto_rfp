import { GetCommand } from '@aws-sdk/lib-dynamodb';
import { AnswerItem } from '@auto-rfp/core';
import { docClient, DBItem } from './db';
import { requireEnv } from './env';
import { PK_NAME, SK_NAME } from '../constants/common';
import { ANSWER_PK } from '../constants/answer';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Build the answer SK.
 * Pattern: {projectId}#{opportunityId}#{fileId}#{questionId}
 * Mirrors the question SK exactly — one answer per question.
 */
export const buildAnswerSK = (
  projectId: string,
  opportunityId: string,
  fileId: string,
  questionId: string,
): string => `${projectId}#${opportunityId}#${fileId}#${questionId}`;

/**
 * Get the answer for a question using the SK pattern:
 * PK=ANSWER, SK={projectId}#{opportunityId}#{fileId}#{questionId}
 */
export const getAnswerForQuestion = async (
  projectId: string,
  opportunityId: string,
  fileId: string,
  questionId: string,
): Promise<(AnswerItem & DBItem) | null> => {
  const sk = buildAnswerSK(projectId, opportunityId, fileId, questionId);

  const res = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: ANSWER_PK,
        [SK_NAME]: sk,
      },
    }),
  );

  return (res.Item as (AnswerItem & DBItem) | undefined) ?? null;
}

export const hasAnswer = async (
  projectId: string,
  opportunityId: string,
  fileId: string,
  questionId: string,
): Promise<boolean> => {
  const answer = await getAnswerForQuestion(projectId, opportunityId, fileId, questionId);
  return !!(answer && answer.text);
}
