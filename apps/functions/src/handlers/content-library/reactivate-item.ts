import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import {
  CONTENT_LIBRARY_PK,
  createContentLibrarySK,
  ReactivateContentItemDTOSchema,
} from '@auto-rfp/core';
import { apiResponse, getUserId, getOrgId } from '@/helpers/api';
import { docClient } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { withSentryLambda } from '../../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
} from '@/middleware/rbac-middleware';
import { PK_NAME, SK_NAME } from '@/constants/common';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

async function baseHandler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  try {
    const itemId = event.pathParameters?.id;
    const params = event.queryStringParameters || {};
    const orgId = params.orgId || getOrgId(event);
    const kbId = params.kbId;
    const userId = getUserId(event);

    if (!itemId || !orgId || !kbId) {
      return apiResponse(400, { error: 'itemId, orgId, and kbId are required' });
    }

    const body = JSON.parse(event.body || '{}');
    const parsed = ReactivateContentItemDTOSchema.safeParse(body);

    if (!parsed.success) {
      return apiResponse(400, { error: 'Invalid request body', details: parsed.error.flatten() });
    }

    const sk = createContentLibrarySK(orgId, kbId, itemId);
    const now = new Date().toISOString();

    // Verify item exists
    const existing = await docClient.send(
      new GetCommand({
        TableName: TABLE_NAME,
        Key: { [PK_NAME]: CONTENT_LIBRARY_PK, [SK_NAME]: sk },
      }),
    );

    if (!existing.Item) {
      return apiResponse(404, { error: 'Content library item not found' });
    }

    // Build update expression
    const updateExprParts = [
      'freshnessStatus = :active',
      'staleSince = :null',
      'staleReason = :null',
      'reactivatedAt = :now',
      'reactivatedBy = :userId',
      'lastFreshnessCheck = :now',
      'updatedAt = :now',
      'updatedBy = :userId',
    ];

    const exprValues: Record<string, unknown> = {
      ':active': 'ACTIVE',
      ':null': null,
      ':now': now,
      ':userId': userId,
    };

    // Optionally update cert expiry date
    if (parsed.data.certExpiryDate !== undefined) {
      updateExprParts.push('certExpiryDate = :certExpiry');
      exprValues[':certExpiry'] = parsed.data.certExpiryDate;
    }

    await docClient.send(
      new UpdateCommand({
        TableName: TABLE_NAME,
        Key: { [PK_NAME]: CONTENT_LIBRARY_PK, [SK_NAME]: sk },
        UpdateExpression: `SET ${updateExprParts.join(', ')}`,
        ExpressionAttributeValues: exprValues,
        ReturnValues: 'ALL_NEW',
      }),
    );

    return apiResponse(200, {
      message: 'Content item reactivated successfully',
      itemId,
      freshnessStatus: 'ACTIVE',
    });
  } catch (error) {
    console.error('Error reactivating content item:', error);
    return apiResponse(500, { error: 'Failed to reactivate content item' });
  }
}

export const handler = middy(withSentryLambda(baseHandler))
  .use(httpErrorMiddleware())
  .use(authContextMiddleware())
  .use(orgMembershipMiddleware());
