import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand, } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';

import { PK_NAME, SK_NAME } from '../constants/common';
import { USER_PK } from '../constants/user';
import { adminUpdateUserAttributes } from '../helpers/cognito';
import { userSk } from '../helpers/user';

const DB_TABLE_NAME = process.env.DB_TABLE_NAME;
if (!DB_TABLE_NAME) throw new Error('DB_TABLE_NAME env var is not set');

const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || process.env.USER_POOL_ID;
if (!USER_POOL_ID) throw new Error('COGNITO_USER_POOL_ID (or USER_POOL_ID) env var is not set');

const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient, {
  marshallOptions: { removeUndefinedValues: true },
});

const cognito = new CognitoIdentityProviderClient({});

const EditUserRoleRequestSchema = z.object({
  orgId: z.string().min(1),
  userId: z.string().min(1),
  roles: z
    .array(z.string().min(1))
    .min(1)
    .transform((arr) =>
      // normalize + de-dupe while preserving order
      Array.from(new Set(arr.map((r) => r.trim()).filter(Boolean))),
    ),
});

export type EditUserRoleRequest = z.infer<typeof EditUserRoleRequestSchema>;

function rolesToCsv(roles: string[]) {
  return roles.join(',');
}

function rolesToSearch(roles: string[]) {
  return roles.map((r) => r.toLowerCase()).join(' ');
}

function parseJsonBody(event: APIGatewayProxyEventV2): unknown {
  if (!event.body) return null;
  try {
    return JSON.parse(event.body);
  } catch {
    return '__INVALID_JSON__';
  }
}

function getCognitoUsernameFromUserItem(userItem: Record<string, any>): string | undefined {
  const fromItem =
    (typeof userItem.cognitoUsername === 'string' && userItem.cognitoUsername.trim()) ||
    (typeof userItem.emailLower === 'string' && userItem.emailLower.trim()) ||
    (typeof userItem.email === 'string' && String(userItem.email).toLowerCase().trim()) ||
    undefined;

  return fromItem || undefined;
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const raw = parseJsonBody(event);
    if (raw === '__INVALID_JSON__') {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    const parsed = EditUserRoleRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return apiResponse(400, {
        message: 'Validation failed',
        errors: parsed.error.issues.map((i) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const { orgId, userId, roles } = parsed.data;
    const key = {
      [PK_NAME]: USER_PK,
      [SK_NAME]: userSk(orgId, userId),
    };

    // 1) Load user (need cognitoUsername; also 404 if missing)
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
    const cognitoUsername = getCognitoUsernameFromUserItem(userItem);

    const now = new Date().toISOString();
    const rolesCsv = rolesToCsv(roles);
    const rolesSearch = rolesToSearch(roles);

    // 2) Update Dynamo
    const updateRes = await docClient.send(
      new UpdateCommand({
        TableName: DB_TABLE_NAME,
        Key: key,
        ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
        UpdateExpression: [
          'SET #roles = :roles',
          '#rolesCsv = :rolesCsv',
          '#rolesSearch = :rolesSearch',
          '#updatedAt = :now',
        ].join(', '),
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
          '#roles': 'roles',
          '#rolesCsv': 'rolesCsv',
          '#rolesSearch': 'rolesSearch',
          '#updatedAt': 'updatedAt',
        },
        ExpressionAttributeValues: {
          ':roles': roles,
          ':rolesCsv': rolesCsv,
          ':rolesSearch': rolesSearch,
          ':now': now,
        },
        ReturnValues: 'ALL_NEW',
      }),
    );

    // 3) Update Cognito (best-effort, but surface non-trivial errors)
    let cognitoUpdated = false;
    if (cognitoUsername) {
      try {
        await adminUpdateUserAttributes(cognito, {
          userPoolId: USER_POOL_ID,
          username: cognitoUsername,
          attributes: [{ Name: 'custom:roles', Value: rolesCsv }],
        });
        cognitoUpdated = true;
      } catch (e: any) {
        const name = e?.name || e?.__type;
        // If the user is gone in cognito, we still keep Dynamo correct.
        if (name !== 'UserNotFoundException') {
          console.warn('adminUpdateUserAttributes failed (continuing):', e);
        }
      }
    }

    return apiResponse(200, {
      ok: true,
      orgId,
      userId,
      roles,
      cognito: {
        username: cognitoUsername ?? null,
        updated: cognitoUpdated,
        customRoles: rolesCsv,
      },
      user: updateRes.Attributes ?? null,
    });
  } catch (err: any) {
    console.error('edit-user error:', err);

    if (err?.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { message: 'User not found' });
    }

    return apiResponse(500, {
      message: 'Failed to edit user',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(baseHandler);