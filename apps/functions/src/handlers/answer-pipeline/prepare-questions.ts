import { Context } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { withSentryLambda } from '../../sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_PK } from '@/constants/question';
import { getProjectById } from '@/helpers/project';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export interface PrepareQuestionsEvent {
  projectId: string;
  questionFileId?: string;
}

export interface QuestionForAnswerGeneration {
  questionId: string;
  projectId: string;
  orgId: string;
  questionText: string;
}

export interface PrepareQuestionsResult {
  questions: QuestionForAnswerGeneration[];
  totalCount: number;
  projectId: string;
  orgId: string;
}

export const baseHandler = async (
  event: PrepareQuestionsEvent,
  _ctx: Context,
): Promise<PrepareQuestionsResult> => {
  console.log('prepare-questions event:', JSON.stringify(event));

  const { projectId, questionFileId } = event;

  if (!projectId) {
    throw new Error('projectId is required');
  }

  // Get orgId from project
  const project = await getProjectById(projectId);
  if (!project) {
    throw new Error(`Project not found: ${projectId}`);
  }

  const orgId = project.orgId;
  if (!orgId) {
    throw new Error(`Project ${projectId} has no orgId`);
  }

  // Query all questions for the project
  const questions: QuestionForAnswerGeneration[] = [];
  let lastKey: Record<string, any> | undefined;

  const prefix = `${projectId}#`;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pk': QUESTION_PK,
          ':prefix': prefix,
        },
        ExclusiveStartKey: lastKey,
      }),
    );

    if (res.Items) {
      for (const item of res.Items) {
        // If questionFileId is specified, only include questions from that file
        if (questionFileId && item.questionFileId !== questionFileId) {
          continue;
        }

        const questionId = item.questionId as string;
        const questionText = item.question as string;

        if (questionId && questionText) {
          questions.push({
            questionId,
            projectId,
            orgId,
            questionText,
          });
        }
      }
    }

    lastKey = res.LastEvaluatedKey as Record<string, any> | undefined;
  } while (lastKey);

  console.log(`Found ${questions.length} questions for project ${projectId}`);

  return {
    questions,
    totalCount: questions.length,
    projectId,
    orgId,
  };
};

export const handler = withSentryLambda(baseHandler);