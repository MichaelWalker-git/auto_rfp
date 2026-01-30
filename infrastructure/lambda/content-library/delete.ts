// lambda/content-library/delete.ts
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import {
  CONTENT_LIBRARY_PK,
  createContentLibrarySK,
} from '@auto-rfp/shared';
import { apiResponse, getOrgId } from '../helpers/api';
import { docClient } from '../helpers/db';
import { requireEnv } from '../helpers/env';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
} from '../middleware/rbac-middleware';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Delete (archive) a content library item
 * DELETE /api/content-library/items/{id}?orgId={orgId}&hardDelete={true}
 */
async function baseHandler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    const itemId = event.pathParameters?.id;
    const orgId = event.queryStringParameters?.orgId || getOrgId(event);
    const hardDelete = event.queryStringParameters?.hardDelete === 'true';

    if (!itemId) {
      return apiResponse(400, { error: 'Missing itemId' });
    }

    if (!orgId) {
      return apiResponse(400, { error: 'Missing orgId' });
    }

    const key = {
      partition_key: CONTENT_LIBRARY_PK,
      sort_key: createContentLibrarySK(orgId, itemId),
    };

    if (hardDelete) {
      await docClient.send(new DeleteCommand({
        TableName: TABLE_NAME,
        Key: key,
      }));
      return apiResponse(200, { message: 'Item permanently deleted' });
    } else {
      const now = new Date().toISOString();
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