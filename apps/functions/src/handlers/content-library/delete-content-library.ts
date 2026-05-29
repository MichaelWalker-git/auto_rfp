import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { CONTENT_LIBRARY_PK, createContentLibrarySK, } from '@auto-rfp/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { deleteItem, docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { withSentryLambda } from '@/sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, } from '@/middleware/rbac-middleware';
import { nowIso } from '@/helpers/date';
import { deleteVectorById } from '@/helpers/pinecone';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Delete (archive) a content library item
 * DELETE /content-library/delete-content-library/{id}?orgId={orgId}&hardDelete={true}&kbId={kbId}
 */
async function baseHandler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    const itemId = event.pathParameters?.id;
    const kbId = event.queryStringParameters?.kbId;
    const orgId = event.queryStringParameters?.orgId || getOrgId(event);
    const hardDelete = event.queryStringParameters?.hardDelete === 'true';

    if (!itemId || !kbId || !orgId) {
      return apiResponse(400, { error: 'Missing required parameter (itemId, kbId, orgId)' });
    }
    const key = {
      partition_key: CONTENT_LIBRARY_PK,
      sort_key: createContentLibrarySK(orgId, kbId, itemId),
    };

    if (hardDelete) {
      await deleteItem(CONTENT_LIBRARY_PK, key.sort_key);
      await deleteVectorById(orgId, itemId)
      return apiResponse(200, { message: 'Item permanently deleted' });
    } else {
      const now = nowIso();
      await docClient.send(new UpdateCommand({
        TableName: TABLE_NAME,
        Key: key,
        UpdateExpression: 'SET #isArchived = :isArchived, #archivedAt = :archivedAt, #updatedAt = :updatedAt',
        ExpressionAttributeNames: {
          '#isArchived': 'isArchived',
          '#archivedAt': 'archivedAt',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':isArchived': true,
          ':archivedAt': now,
          ':updatedAt': now,
        },
      }));
      await deleteVectorById(orgId, itemId)
      return apiResponse(200, { message: 'Item archived' });
    }
  } catch (error) {
    console.error('Error deleting content library item:', error);
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