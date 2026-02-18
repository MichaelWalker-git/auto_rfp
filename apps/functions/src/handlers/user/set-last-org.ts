import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { apiResponse, getUserId } from '@/helpers/api';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { USER_PK } from '@/constants/user';
import { withSentryLambda } from '../../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
} from '@/middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * PUT /user/set-last-org
 *
 * Stores the user's last selected organization ID in a preferences record.
 * Record: PK=USER, SK=PREFS#<userId>
 */
export const baseHandler = async (
  event: APIGatewayProxyEventV2,
) => {
  try {
    const userId = getUserId(event);
    if (!userId) {
      return apiResponse(401, { message: 'Authentication required' });
    }

    const body = JSON.parse(event.body || '{}');
    const { orgId } = body;

    if (!orgId || typeof orgId !== 'string') {
      return apiResponse(400, { message: 'orgId is required' });
    }

    await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: USER_PK,
          [SK_NAME]: `PREFS#${userId}`,
        },
        UpdateExpression: 'SET lastOrgId = :orgId, updatedAt = :now, entityType = :et, userId = :uid',
        ExpressionAttributeValues: {
          ':orgId': orgId,
          ':now': new Date().toISOString(),
          ':et': 'USER_PREFS',
          ':uid': userId,
        },
      }),
    );

    return apiResponse(200, { success: true, lastOrgId: orgId });
  } catch (err) {
    console.error('Error in set-last-org:', err);
    return apiResponse(500, {
      message: 'Failed to set last org',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(httpErrorMiddleware()),
);
