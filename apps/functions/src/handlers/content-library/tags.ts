// lambda/content-library/tags.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import {
  CONTENT_LIBRARY_PK,
} from '@auto-rfp/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { withSentryLambda } from '../../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
} from '@/middleware/rbac-middleware';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Get distinct tags for an organization
 * GET /api/content-library/tags?orgId={orgId}
 */
async function baseHandler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    const orgId = event.queryStringParameters?.orgId || getOrgId(event);

    if (!orgId) {
      return apiResponse(400, { error: 'Missing orgId' });
    }

    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: 'partition_key = :pk AND begins_with(sort_key, :sk_prefix)',
      ExpressionAttributeValues: {
        ':pk': CONTENT_LIBRARY_PK,
        ':sk_prefix': `${orgId}#`,
      },
      ProjectionExpression: 'tags, isArchived',
    }));

    const tagCount = new Map<string, number>();

    for (const item of result.Items || []) {
      if (item.isArchived) continue;
      const tags = (item.tags as string[]) || [];
      for (const tag of tags) {
        tagCount.set(tag, (tagCount.get(tag) || 0) + 1);
      }
    }

    const tags = Array.from(tagCount.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return apiResponse(200, { data: { tags } });
  } catch (error) {
    console.error('Error getting content library tags:', error);
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