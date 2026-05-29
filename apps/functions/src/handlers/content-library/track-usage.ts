import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { CONTENT_LIBRARY_PK, createContentLibrarySK, } from '@auto-rfp/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { withSentryLambda } from '@/sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, } from '@/middleware/rbac-middleware';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

async function baseHandler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    const itemId = event.pathParameters?.id;
    const orgId = event.queryStringParameters?.orgId || getOrgId(event);

    if (!itemId) {
      return apiResponse(400, { error: 'Missing itemId' });
    }

    if (!orgId) {
      return apiResponse(400, { error: 'Missing orgId' });
    }

    let body: unknown;
    try {
      body = event.body ? JSON.parse(event.body) : null;
    } catch {
      return apiResponse(400, { error: 'Invalid JSON in request body' });
    }

    const projectId = (body as any)?.projectId;
    if (!projectId) {
      return apiResponse(400, { error: 'Missing projectId in request body' });
    }

    const now = new Date().toISOString();
    const kbId = event.queryStringParameters?.kbId || '';
    const key = {
      partition_key: CONTENT_LIBRARY_PK,
      sort_key: createContentLibrarySK(orgId, kbId, itemId),
    };

    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: key,
      UpdateExpression: 'SET #usageCount = if_not_exists(#usageCount, :zero) + :inc, #lastUsedAt = :now',
      ExpressionAttributeNames: {
        '#usageCount': 'usageCount',
        '#lastUsedAt': 'lastUsedAt',
      },
      ExpressionAttributeValues: {
        ':inc': 1,
        ':now': now,
        ':zero': 0,
      },
    }));

    try {
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: key,
        UpdateExpression: 'SET #usedInProjectIds = list_append(if_not_exists(#usedInProjectIds, :emptyList), :projectId)',
        ConditionExpression: 'attribute_not_exists(#usedInProjectIds) OR NOT contains(#usedInProjectIds, :projectIdStr)',
        ExpressionAttributeNames: {
          '#usedInProjectIds': 'usedInProjectIds',
        },
        ExpressionAttributeValues: {
          ':projectId': [projectId],
          ':projectIdStr': projectId,
          ':emptyList': [],
        },
      }));
    } catch (conditionalError: unknown) {
      if (
        conditionalError &&
        typeof conditionalError === 'object' &&
        'name' in conditionalError &&
        conditionalError.name !== 'ConditionalCheckFailedException'
      ) {
        throw conditionalError;
      }
    }

    return apiResponse(200, { message: 'Usage tracked' });
  } catch (error) {
    console.error('Error tracking content library usage:', error);
    return apiResponse(500, {
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(httpErrorMiddleware())
);