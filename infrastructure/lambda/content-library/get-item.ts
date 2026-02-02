import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { CONTENT_LIBRARY_PK, ContentLibraryItem, createContentLibrarySK, } from '@auto-rfp/shared';
import { apiResponse, getOrgId } from '../helpers/api';
import { docClient } from '../helpers/db';
import { requireEnv } from '../helpers/env';
import { withSentryLambda } from '../sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, } from '../middleware/rbac-middleware';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Get a single content library item
 * GET /api/content-library/items/{id}?orgId={orgId}
 */
async function baseHandler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    const itemId = event.pathParameters?.id;
    const orgId = event.queryStringParameters?.orgId || getOrgId(event);
    const kbId = event.queryStringParameters?.kbId;

    if (!orgId || !kbId || !itemId) {
      return apiResponse(400, { error: 'Missing orgId, kbId or itemId' });
    }

    const result = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        partition_key: CONTENT_LIBRARY_PK,
        sort_key: createContentLibrarySK(orgId, kbId, itemId),
      },
    }));

    if (!result.Item) {
      return apiResponse(404, { error: 'Content library item not found' });
    }

    const item = result.Item as ContentLibraryItem;
    return apiResponse(200, item);
  } catch (error) {
    console.error('Error getting content library item:', error);
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