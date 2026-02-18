import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
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
import { nowIso } from '@/helpers/date';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * POST /user/add-to-organization
 * Body: { userId, targetOrgId, role }
 *
 * Adds an existing user to an additional organization.
 * Creates a new DynamoDB membership record without touching Cognito.
 * Requires org:manage_users permission in the CURRENT org.
 */
export const baseHandler = async (event: APIGatewayProxyEventV2) => {
  try {
    const currentOrgId = getOrgId(event);
    if (!currentOrgId) return apiResponse(400, { message: 'Org Id is required' });

    const body = JSON.parse(event.body || '{}');
    const { userId, targetOrgId, role } = body;

    if (!userId || !targetOrgId) {
      return apiResponse(400, { message: 'userId and targetOrgId are required' });
    }

    const validRole = role || 'VIEWER';

    // Verify the user exists in the current org
    const currentMembershipSk = userSk(currentOrgId, userId);
    const existingRes = await docClient.send(
      new GetCommand({
        TableName: DB_TABLE_NAME,
        Key: { [PK_NAME]: USER_PK, [SK_NAME]: currentMembershipSk },
        ProjectionExpression: 'email, firstName, lastName, displayName, phone, cognitoUsername',
      }),
    );

    if (!existingRes.Item) {
      return apiResponse(404, { message: 'User not found in current organization' });
    }

    const existingUser = existingRes.Item;

    // Check if user already exists in the target org
    const targetMembershipSk = userSk(targetOrgId, userId);
    const targetRes = await docClient.send(
      new GetCommand({
        TableName: DB_TABLE_NAME,
        Key: { [PK_NAME]: USER_PK, [SK_NAME]: targetMembershipSk },
      }),
    );

    if (targetRes.Item) {
      return apiResponse(409, { message: 'User is already a member of the target organization' });
    }

    // Create the new membership record
    const now = nowIso();
    const adminUserId = getUserId(event) ?? 'system';

    const newMembership = {
      [PK_NAME]: USER_PK,
      [SK_NAME]: targetMembershipSk,
      entityType: 'USER',
      orgId: targetOrgId,
      userId,
      email: existingUser.email,
      firstName: existingUser.firstName,
      lastName: existingUser.lastName,
      displayName: existingUser.displayName,
      phone: existingUser.phone,
      cognitoUsername: existingUser.cognitoUsername,
      role: validRole,
      status: 'ACTIVE',
      createdAt: now,
      updatedAt: now,
      addedBy: adminUserId,
    };

    await docClient.send(
      new PutCommand({
        TableName: DB_TABLE_NAME,
        Item: newMembership,
        ConditionExpression: 'attribute_not_exists(#pk)',
        ExpressionAttributeNames: { '#pk': PK_NAME },
      }),
    );

    return apiResponse(201, {
      message: 'User added to organization',
      userId,
      targetOrgId,
      role: validRole,
    });
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') {
      return apiResponse(409, { message: 'User already exists in target organization' });
    }
    console.error('Error adding user to organization:', err);
    return apiResponse(500, { message: 'Failed to add user to organization' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:manage_users'))
    .use(httpErrorMiddleware()),
);
