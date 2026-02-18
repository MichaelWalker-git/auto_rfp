import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { USER_PK } from '@/constants/user';
import { adminUpdateUserAttributes } from '@/helpers/cognito';
import { userSk } from '@/helpers/user';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { EditUserRequestSchema } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import middy from '@middy/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const USER_POOL_ID = requireEnv('COGNITO_USER_POOL_ID');
const cognito = new CognitoIdentityProviderClient({});

function getCognitoUsername(item: Record<string, any>): string | undefined {
  return (
    (typeof item.cognitoUsername === 'string' && item.cognitoUsername.trim()) ||
    (typeof item.emailLower === 'string' && item.emailLower.trim()) ||
    (typeof item.email === 'string' && String(item.email).toLowerCase().trim()) ||
    undefined
  ) || undefined;
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) return apiResponse(400, { message: 'Missing request body' });

    let raw: unknown;
    try { raw = JSON.parse(event.body); } catch { return apiResponse(400, { message: 'Invalid JSON' }); }

    const parsed = EditUserRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return apiResponse(400, {
        message: 'Validation failed',
        errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const dto = parsed.data;
    const key = { [PK_NAME]: USER_PK, [SK_NAME]: userSk(dto.orgId, dto.userId) };

    const existing = await docClient.send(new GetCommand({ TableName: DB_TABLE_NAME, Key: key }));
    if (!existing.Item) return apiResponse(404, { message: 'User not found' });

    const userItem = existing.Item as Record<string, any>;
    const cognitoUsername = getCognitoUsername(userItem);
    const now = new Date().toISOString();

    const names: Record<string, string> = { '#pk': PK_NAME, '#sk': SK_NAME, '#ua': 'updatedAt' };
    const values: Record<string, unknown> = { ':now': now };
    const setParts: string[] = ['#ua = :now'];

    if (dto.firstName !== undefined) {
      names['#fn'] = 'firstName'; values[':fn'] = dto.firstName; setParts.push('#fn = :fn');
      names['#fnl'] = 'firstNameLower'; values[':fnl'] = dto.firstName.toLowerCase(); setParts.push('#fnl = :fnl');
    }
    if (dto.lastName !== undefined) {
      names['#ln'] = 'lastName'; values[':ln'] = dto.lastName; setParts.push('#ln = :ln');
      names['#lnl'] = 'lastNameLower'; values[':lnl'] = dto.lastName.toLowerCase(); setParts.push('#lnl = :lnl');
    }
    if (dto.displayName !== undefined) {
      names['#dn'] = 'displayName'; values[':dn'] = dto.displayName; setParts.push('#dn = :dn');
      names['#dnl'] = 'displayNameLower'; values[':dnl'] = dto.displayName.toLowerCase(); setParts.push('#dnl = :dnl');
    }
    if (dto.phone !== undefined) {
      names['#ph'] = 'phone'; values[':ph'] = dto.phone; setParts.push('#ph = :ph');
    }
    if (dto.role !== undefined) {
      names['#rl'] = 'role'; values[':rl'] = dto.role; setParts.push('#rl = :rl');
    }
    if (dto.status !== undefined) {
      names['#st'] = 'status'; values[':st'] = dto.status; setParts.push('#st = :st');
    }

    // Rebuild searchText
    const fn = dto.firstName ?? userItem.firstName ?? '';
    const ln = dto.lastName ?? userItem.lastName ?? '';
    const dn = dto.displayName ?? userItem.displayName ?? '';
    const ph = dto.phone ?? userItem.phone ?? '';
    const em = userItem.email ?? '';
    const searchParts = [em, fn, ln, dn, ph].map((s) => String(s).trim().toLowerCase()).filter(Boolean);
    names['#srt'] = 'searchText'; values[':srt'] = [...new Set(searchParts)].join(' '); setParts.push('#srt = :srt');

    const updateRes = await docClient.send(new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: key,
      ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
      UpdateExpression: `SET ${setParts.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: 'ALL_NEW',
    }));

    // Sync role to Cognito if changed
    let cognitoUpdated = false;
    if (dto.role !== undefined && cognitoUsername) {
      try {
        await adminUpdateUserAttributes(cognito, {
          userPoolId: USER_POOL_ID,
          username: cognitoUsername,
          attributes: [{ Name: 'custom:role', Value: dto.role }],
        });
        cognitoUpdated = true;
      } catch (e: any) {
        if (e?.name !== 'UserNotFoundException') {
          console.warn('adminUpdateUserAttributes failed (continuing):', e);
        }
      }
    }

    const updated = updateRes.Attributes ?? {};
    return apiResponse(200, {
      ok: true,
      orgId: dto.orgId,
      userId: dto.userId,
      user: {
        orgId: updated.orgId,
        userId: updated.userId,
        email: updated.email,
        firstName: updated.firstName ?? '',
        lastName: updated.lastName ?? '',
        displayName: updated.displayName ?? '',
        phone: updated.phone ?? '',
        role: updated.role,
        status: updated.status,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      },
      cognito: { username: cognitoUsername ?? null, updated: cognitoUpdated },
    });
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { message: 'User not found' });
    }
    console.error('edit-user error:', err);
    return apiResponse(500, { message: 'Failed to edit user' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('user:edit'))
    .use(httpErrorMiddleware()),
);