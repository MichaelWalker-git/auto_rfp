import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DeleteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { apiResponse, getOrgId } from '@/helpers/api';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { USER_PK } from '@/constants/user';
import { userSk } from '@/helpers/user';
import { withSentryLambda } from '../../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const GSI_BY_USER_ID = 'byUserId';

/**
 * POST /user/remove-from-organization
 * Body: { userId, targetOrgId }
 *
 * Removes a user's membership from a specific organization.
 * Does NOT delete the Cognito user (they may belong to other orgs).
 * Requires org:manage_users permission.
 */
export const baseHandler = async (event: APIGatewayProxyEventV2) => {
  try {
    const currentOrgId = getOrgId(event);
    if (!currentOrgId) return apiResponse(400, { message: 'Org Id is required' });

    const body = JSON.parse(event.body || '{}');
    const { userId, targetOrgId } = body;

    if (!userId || !targetOrgId) {
      return apiResponse(400, { message: 'userId and targetOrgId are required' });
    }

    // Safety: check how many orgs the user belongs to
    // Don't allow removing from the LAST org (would orphan the Cognito user)
    const membershipCount = await countUserMemberships(userId);
    if (membershipCount <= 1) {
      return apiResponse(400, {
        message: 'Cannot remove user from their only organization. Use "Delete User" instead to fully remove the user.',
      });
    }

    // Delete the membership record
    const sk = userSk(targetOrgId, userId);
    await docClient.send(
      new DeleteCommand({
        TableName: DB_TABLE_NAME,
        Key: { [PK_NAME]: USER_PK, [SK_NAME]: sk },
        ConditionExpression: 'attribute_exists(#pk)',
        ExpressionAttributeNames: { '#pk': PK_NAME },
      }),
    );

    return apiResponse(200, {
      message: 'User removed from organization',
      userId,
      targetOrgId,
      remainingMemberships: membershipCount - 1,
    });
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { message: 'User membership not found in target organization' });
    }
    console.error('Error removing user from organization:', err);
    return apiResponse(500, { message: 'Failed to remove user from organization' });
  }
};

async function countUserMemberships(userId: string): Promise<number> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      IndexName: GSI_BY_USER_ID,
      KeyConditionExpression: '#userId = :userId AND #pk = :pk',
      ExpressionAttributeNames: {
        '#userId': 'userId',
        '#pk': PK_NAME,
      },
      ExpressionAttributeValues: {
        ':userId': userId,
        ':pk': USER_PK,
      },
      Select: 'COUNT',
    }),
  );
  return res.Count ?? 0;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:manage_users'))
    .use(httpErrorMiddleware()),
);
