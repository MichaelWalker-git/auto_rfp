import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DeleteCommand, GetCommand, QueryCommand, } from '@aws-sdk/lib-dynamodb';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_PK } from '@/constants/question';
import { ANSWER_PK } from '@/constants/answer';
import { PK as COLLAB_PK } from '@/constants/collaboration';
import middy from '@middy/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '@/middleware/rbac-middleware';
import { requireEnv } from '@/helpers/env';
import { deleteItem, docClient, queryBySkPrefix } from '@/helpers/db';
import { buildQuestionSK } from '@/helpers/question';
import { buildAssignmentSK, buildCommentSK } from '@/helpers/collaboration';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

async function deleteQuestionItem(projectId: string, questionId: string): Promise<boolean> {
  const key = {
    [PK_NAME]: QUESTION_PK,
    [SK_NAME]: buildQuestionSK(projectId, questionId),
  };

  const existing = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: key,
    }),
  );

  if (!existing.Item) return false;

  await deleteItem(QUESTION_PK, buildQuestionSK(projectId, questionId));

  return true;
}

async function findAnswerKeysForQuestion(projectId: string, questionId: string) {
  const keys: Array<Record<string, any>> = [];
  const skPrefix = `${projectId}#${questionId}#`;

  let lastKey: Record<string, any> | undefined;

  do {
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
        ExclusiveStartKey: lastKey,
        Limit: 250,
        ProjectionExpression: '#pk, #sk',
      }),
    );

    for (const item of res.Items ?? []) {
      keys.push({
        [PK_NAME]: item[PK_NAME],
        [SK_NAME]: item[SK_NAME],
      });
    }

    lastKey = res.LastEvaluatedKey as any;
  } while (lastKey);

  return keys;
}

async function deleteAnswerItems(keys: Array<Record<string, any>>): Promise<number> {
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

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  console.log('remove-question event:', JSON.stringify(event));

  // You said UI calls POST with queryStringParameters; keep it like this.
  const { projectId, questionId } = event.queryStringParameters ?? {};

  if (!projectId || !questionId) {
    return apiResponse(400, { message: 'projectId and questionId are required' });
  }

  try {
    // 1) delete question
    const existed = await deleteQuestionItem(projectId, questionId);
    if (!existed) {
      return apiResponse(404, { message: 'Question not found', projectId, questionId });
    }

    // 2) delete answers for this question (by SK prefix)
    const answerKeys = await findAnswerKeysForQuestion(projectId, questionId);
    const answersDeleted = await deleteAnswerItems(answerKeys);

    // 3) cascade delete assignments for this question
    // Assignments use SK prefix: {orgId}#{projectId}#{questionId}
    // We need orgId — get it from query params or scan by projectId prefix
    const orgId = event.queryStringParameters?.orgId;
    let assignmentsDeleted = 0;
    let commentsDeleted = 0;

    if (orgId) {
      // Delete all assignments for this question (per-user SK: orgId#projectId#questionId#userId)
      const assignmentPrefix = `${orgId}#${projectId}#${questionId}`;
      const assignmentItems = await queryBySkPrefix<{ partition_key: string; sort_key: string }>(
        COLLAB_PK.ASSIGNMENT,
        assignmentPrefix,
      );
      for (const item of assignmentItems) {
        await deleteItem(COLLAB_PK.ASSIGNMENT, item.sort_key);
        assignmentsDeleted++;
      }

      // Delete all comments for this question (all entity types)
      // Comment SK: orgId#projectId#QUESTION#questionId#commentId
      const commentPrefix = `${orgId}#${projectId}#QUESTION#${questionId}#`;
      const commentItems = await queryBySkPrefix<{ partition_key: string; sort_key: string }>(
        COLLAB_PK.COMMENT,
        commentPrefix,
      );
      for (const item of commentItems) {
        await deleteItem(COLLAB_PK.COMMENT, item.sort_key);
        commentsDeleted++;
      }
    }

    return apiResponse(200, {
      ok: true,
      projectId,
      questionId,
      questionDeleted: true,
      answersDeleted,
      assignmentsDeleted,
      commentsDeleted,
    });
  } catch (err: any) {
    console.error('remove-question error:', err);
    return apiResponse(500, {
      message: 'Failed to remove question',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:delete'))
    .use(httpErrorMiddleware())
);
