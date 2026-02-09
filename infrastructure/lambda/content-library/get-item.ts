import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { CONTENT_LIBRARY_PK, ContentLibraryItem, createContentLibrarySK, } from '@auto-rfp/shared';
import { apiResponse, getOrgId } from '../helpers/api';
import { getItem } from '../helpers/db';
import { withSentryLambda } from '../sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, } from '../middleware/rbac-middleware';

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

    const result = await getItem<ContentLibraryItem>(
      CONTENT_LIBRARY_PK,
      createContentLibrarySK(orgId, kbId, itemId)
    );

    if (!result) {
      return apiResponse(404, { error: 'Content library item not found' });
    }

    return apiResponse(200, result);
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