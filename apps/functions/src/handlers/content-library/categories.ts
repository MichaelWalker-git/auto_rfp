import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { CONTENT_LIBRARY_PK, } from '@auto-rfp/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { withSentryLambda } from '../../sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, } from '@/middleware/rbac-middleware';
import { PK_NAME, SK_NAME } from '@/constants/common';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Get distinct categories for an organization
 * GET /content-library/categories?orgId={orgId}
 */
async function baseHandler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    console.log('event', event);
    const orgId = event.queryStringParameters?.orgId || getOrgId(event);

    if (!orgId) {
      return apiResponse(400, { error: 'Missing orgId' });
    }

    const result = await docClient.send(new QueryCommand({
      TableName: TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :sk_prefix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': CONTENT_LIBRARY_PK,
        ':sk_prefix': `${orgId}#`,
      },
      ProjectionExpression: 'category, isArchived',
    }));

    const categoryCount = new Map<string, number>();

    for (const item of result.Items || []) {
      if (item.isArchived || !item.category) continue;
      const category = item.category as string;
      categoryCount.set(category, (categoryCount.get(category) || 0) + 1);
    }

    const categories = Array.from(categoryCount.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    return apiResponse(200, categories);
  } catch (error) {
    console.error('Error getting content library categories:', error);
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