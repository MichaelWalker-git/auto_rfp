import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';

import { PK_NAME, SK_NAME } from '@/constants/common';
import { USER_PK } from '@/constants/user';

import { adminDeleteUser } from '@/helpers/cognito';
import { userSk } from '@/helpers/user';
import middy from '@middy/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
if (!DB_TABLE_NAME) throw new Error('DB_TABLE_NAME env var is not set');

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || process.env.USER_POOL_ID;
if (!USER_POOL_ID) throw new Error('COGNITO_USER_POOL_ID (or USER_POOL_ID) env var is not set');

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const cognito = new CognitoIdentityProviderClient({});

function parseBody(event: APIGatewayProxyEventV2): any {
  if (!event.body) return null;
  try {
    return JSON.parse(event.body);
  } catch {
    return '__INVALID_JSON__';
  }
}

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const body = parseBody(event);
    if (body === '__INVALID_JSON__') {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    const orgId =
      event.queryStringParameters?.orgId ||
      body?.orgId ||
      body?.organizationId;

    const userId =
      event.pathParameters?.userId ||
      event.pathParameters?.id ||
      event.queryStringParameters?.userId ||
      body?.userId;

    if (!orgId || !userId) {
      return apiResponse(400, {
        message: 'orgId and userId are required',
      });
    }

    const key = {
      [PK_NAME]: USER_PK,
      [SK_NAME]: userSk(String(orgId), String(userId)),
    };

    // 1) Load user (to get cognitoUsername)
    const existing = await docClient.send(
      new GetCommand({
        TableName: DB_TABLE_NAME,
        Key: key,
      }),
    );

    if (!existing.Item) {
      return apiResponse(404, { message: 'User not found', orgId, userId });
    }

    const userItem = existing.Item as Record<string, any>;
    const cognitoUsername =
      (typeof userItem.cognitoUsername === 'string' && userItem.cognitoUsername) ||
      (typeof userItem.emailLower === 'string' && userItem.emailLower) ||
      (typeof userItem.email === 'string' && userItem.email.toLowerCase()) ||
      undefined;

    // 2) Count remaining org memberships for this user (before deleting this one)
    const membershipQuery = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        FilterExpression: 'contains(#sk, :userIdSuffix)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
        ExpressionAttributeValues: {
          ':pk': USER_PK,
          ':skPrefix': `ORG#`,
          ':userIdSuffix': `#USER#${userId}`,
        },
        Select: 'COUNT',
      }),
    );

    const totalMemberships = membershipQuery.Count ?? 0;
    const isLastOrg = totalMemberships <= 1;

    // 3) Delete from Cognito ONLY if this is the user's last org membership
    let cognitoDeleted = false;
    if (isLastOrg && cognitoUsername) {
      try {
        await adminDeleteUser(cognito, {
          userPoolId: USER_POOL_ID,
          username: cognitoUsername,
        });
        cognitoDeleted = true;
      } catch (e: any) {
        const name = e?.name || e?.__type;
        if (name === 'UserNotFoundException') {
          cognitoDeleted = false;
        } else {
          console.warn('adminDeleteUser failed (continuing to delete Dynamo user):', e);
        }
      }
    }

    // 4) Delete Dynamo item for this org membership (only if exists)
    await docClient.send(
      new DeleteCommand({
        TableName: DB_TABLE_NAME,
        Key: key,
        ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
      }),
    );

    setAuditContext(event, {
      action: 'USER_DELETED',
      resource: 'user',
      resourceId: String(userId),
    });

    return apiResponse(200, {
      ok: true,
      orgId,
      userId,
      deleted: {
        dynamo: true,
        cognito: cognitoDeleted,
      },
      isLastOrg,
      remainingMemberships: Math.max(0, totalMemberships - 1),
      cognitoUsername: cognitoUsername ?? null,
    });
  } catch (err: any) {
    console.error('remove-user error:', err);

    if (err?.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { message: 'User not found' });
    }

    return apiResponse(500, {
      message: 'Failed to remove user',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('user:delete'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
