import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
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
import { nowIso } from '../helpers/date';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

async function baseHandler(
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> {
  try {
    const itemId = event.pathParameters?.id;
    const orgId = event.queryStringParameters?.orgId || getOrgId(event);
    const kbId = event.queryStringParameters?.kbId

    if (!itemId) {
      return apiResponse(400, { error: 'Missing itemId' });
    }

    if (!orgId) {
      return apiResponse(400, { error: 'Missing orgId' });
    }

    if (!kbId) {
      return apiResponse(400, { error: 'Missing kbId' });
    }

    const existingResult = await docClient.send(new GetCommand({
      TableName: TABLE_NAME,
      Key: {
        partition_key: CONTENT_LIBRARY_PK,
        sort_key: createContentLibrarySK(orgId, kbId, itemId),
      },
    }));

    if (!existingResult.Item) {
      return apiResponse(404, { error: 'Content library item not found' });
    }

    if (existingResult.Item.isArchived) {
      return apiResponse(400, { error: 'Cannot approve an archived item' });
    }

    let body: unknown;
    try {
      body = event.body ? JSON.parse(event.body) : null;
    } catch {
      // Continue if body parse fails
    }

    const userId = (body as any)?.approvedBy || (event.requestContext as any)?.authorizer?.claims?.sub || 'system';
    const now =  nowIso();

    await docClient.send(new UpdateCommand({
      TableName: TABLE_NAME,
      Key: {
        partition_key: CONTENT_LIBRARY_PK,
        sort_key: createContentLibrarySK(orgId, kbId, itemId),
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