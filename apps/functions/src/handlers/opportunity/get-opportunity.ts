import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';

import { withSentryLambda } from '../../sentry-lambda';
import { apiResponse, getOrgId } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';

import { PK_NAME, SK_NAME } from '@/constants/common';
import { QUESTION_FILE_PK } from '@/constants/question-file';

import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

import { getOpportunity } from '@/helpers/opportunity';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const safeJsonParse = <T,>(raw: string): T | undefined => {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
};

const listQuestionFilesByOpportunity = async (args: {
  orgId: string;
  projectId: string;
  oppId: string;
  limit?: number;
  nextToken?: Record<string, any>;
}) => {
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      FilterExpression: '#orgId = :orgId AND #oppId = :oppId',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
        '#orgId': 'orgId',
        '#oppId': 'oppId',
      },
      ExpressionAttributeValues: {
        ':pk': QUESTION_FILE_PK,
        ':skPrefix': `${args.projectId}#`,
        ':orgId': args.orgId,
        ':oppId': args.oppId,
      },
      Limit: args.limit,
      ExclusiveStartKey: args.nextToken,
      ScanIndexForward: false,
    }),
  );

  return {
    items: res.Items ?? [],
    nextToken: res.LastEvaluatedKey ?? null,
  };
};

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(401, { error: 'Unauthorized' });
  }

  const q = event.queryStringParameters ?? {};
  const projectId = q.projectId;
  const oppId = q.oppId;

  if (!projectId || !oppId) {
    return apiResponse(400, { error: 'projectId and oppId are required' });
  }

  const decodedNextToken = q.qfNextToken ? decodeURIComponent(q.qfNextToken) : undefined;
  const exclusiveStartKey = decodedNextToken
    ? safeJsonParse<Record<string, any>>(decodedNextToken)
    : undefined;

  if (decodedNextToken && !exclusiveStartKey) {
    return apiResponse(400, { error: 'Invalid qfNextToken' });
  }

  const opportunity = await getOpportunity({ orgId, projectId, oppId });

  if (!opportunity) {
    return apiResponse(404, { error: 'Opportunity not found' });
  }

  const questionFiles = await listQuestionFilesByOpportunity({
    orgId,
    projectId,
    oppId,
    limit: q.qfLimit ? Math.min(200, Number(q.qfLimit)) : 50,
    nextToken: exclusiveStartKey,
  });

  return apiResponse(200, {
    ...opportunity.item,
    questionFiles: {
      items: questionFiles.items,
      nextToken: questionFiles.nextToken
        ? JSON.stringify(questionFiles.nextToken)
        : null,
    },
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read')),
);
