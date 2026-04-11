import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';

import { apiResponse } from '@/helpers/api';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_PK } from '@/constants/question';
import { ANSWER_PK } from '@/constants/answer';
import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Lightweight endpoint that returns question/answer counts for a project
 * without loading full payloads. Uses DynamoDB SELECT: 'COUNT' queries.
 *
 * GET /projects/questions-count/{projectId}
 */
export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const { projectId } = event.pathParameters || {};
  if (!projectId) {
    return apiResponse(400, { message: 'Missing projectId' });
  }

  const opportunityId = event.queryStringParameters?.opportunityId;
  const prefix = opportunityId ? `${projectId}#${opportunityId}#` : `${projectId}#`;

  const [totalQuestions, totalAnswers] = await Promise.all([
    countItems(QUESTION_PK, prefix),
    countItems(ANSWER_PK, prefix),
  ]);

  return apiResponse(200, { totalQuestions, totalAnswers });
};

const countItems = async (pk: string, skPrefix: string): Promise<number> => {
  let count = 0;
  let lastKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :prefix)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
        ExpressionAttributeValues: { ':pk': pk, ':prefix': skPrefix },
        Select: 'COUNT',
        ExclusiveStartKey: lastKey,
      }),
    );

    count += res.Count ?? 0;
    lastKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastKey);

  return count;
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('question:read'))
    .use(httpErrorMiddleware()),
);