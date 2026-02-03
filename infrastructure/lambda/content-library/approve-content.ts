import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { CONTENT_LIBRARY_PK, ContentLibraryItem, createContentLibrarySK, } from '@auto-rfp/shared';
import { apiResponse, getOrgId } from '../helpers/api';
import { docClient, getItem } from '../helpers/db';
import { requireEnv } from '../helpers/env';
import { withSentryLambda } from '../sentry-lambda';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, } from '../middleware/rbac-middleware';
import { nowIso } from '../helpers/date';
import { PK_NAME, SK_NAME } from '../constants/common';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

async function baseHandler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    const itemId = event.pathParameters?.id;
    const orgId = event.queryStringParameters?.orgId || getOrgId(event);
    const kbId = event.queryStringParameters?.kbId;

    if (!itemId || !orgId || !kbId) {
      return apiResponse(400, { error: 'Missing required field' });
    }

    const item = await getItem<ContentLibraryItem>(
      CONTENT_LIBRARY_PK,
      createContentLibrarySK(orgId, kbId, itemId)
    );

    if (!item) {
      return apiResponse(404, { error: 'Content library item not found' });
    }

    if (item.isArchived) {
      return apiResponse(400, { error: 'Cannot approve an archived item' });
    }

    const userId = (event.requestContext as any)?.authorizer?.claims?.sub || 'system'
    const now = nowIso();

    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        [PK_NAME]: CONTENT_LIBRARY_PK,
        [SK_NAME]: createContentLibrarySK(orgId, kbId, itemId),
      },
      UpdateExpression: 'SET #approvalStatus = :status, #approvedBy = :approvedBy, #approvedAt = :approvedAt, #updatedAt = :updatedAt',
      ExpressionAttributeNames: {
        '#approvalStatus': 'approvalStatus',
        '#approvedBy': 'approvedBy',
        '#approvedAt': 'approvedAt',
        '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':status': 'APPROVED',
        ':approvedBy': userId,
        ':approvedAt': now,
        ':updatedAt': now,
      },
    }));

    return apiResponse(200, { message: 'Item approved' });
  } catch (error) {
    console.error('Error approving content library item:', error);
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