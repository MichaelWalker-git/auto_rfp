import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

import { PK_NAME, SK_NAME } from '../constants/common';
import { USER_PK } from '../constants/user';

import type { CreateUserDTO } from '@auto-rfp/core';
import { adminCreateUser, adminDeleteUser } from './cognito';
import { safeTrim, safeLowerCase } from './safe-string';
import { createItem, getItem, docClient } from './db';
import { requireEnv } from './env';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const userSk = (orgId: string, userId: string) => `ORG#${orgId}#USER#${userId}`;

// ─── Lookup helpers ───────────────────────────────────────────────────────────

interface UserRecord {
  userId: string;
  email: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
}

export const getUserByOrgAndId = async (
  orgId: string,
  userId: string,
): Promise<UserRecord | null> =>
  getItem<UserRecord>(USER_PK, userSk(orgId, userId));

/**
 * List all members of an org with their userId and email.
 * Used to build recipientUserIds / recipientEmails for notifications.
 */
export const getOrgMembers = async (
  orgId: string,
): Promise<Array<{ userId: string; email: string }>> => {
  const members: Array<{ userId: string; email: string }> = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
        ExpressionAttributeValues: { ':pk': USER_PK, ':skPrefix': userSk(orgId, '') },
        ProjectionExpression: 'userId, email',
        ExclusiveStartKey,
      }),
    );
    for (const item of res.Items ?? []) {
      if (item['userId'] && item['email']) {
        members.push({ userId: item['userId'] as string, email: item['email'] as string });
      }
    }
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);

  return members;
};

export type CreateUserDeps = {
  ddb: DynamoDBDocumentClient;
  cognito: CognitoIdentityProviderClient;
  tableName: string;
  userPoolId: string;
};

export type CreateUserOptions = {
  sendCognitoInvite?: boolean;
  markEmailVerified?: boolean;
};

export type CreateUserResult = {
  userId: string;
  cognitoUsername: string;
  item: Record<string, any>;
};

function norm(s?: unknown): string | undefined {
  const v = safeTrim(s);
  return v.length ? v : undefined;
}

function normalizePhone(s?: string): string | undefined {
  const v = norm(s);
  if (!v) return undefined;
  return v.replace(/\s+/g, '');
}

function buildSearchText(parts: Array<string | undefined>): string {
  const cleaned = parts
    .map((p) => (p ? p.trim().toLowerCase() : undefined))
    .filter(Boolean) as string[];
  return Array.from(new Set(cleaned)).join(' ');
}

export async function addExistingUserToOrg(
  deps: CreateUserDeps,
  input: { dto: CreateUserDTO; existingCognitoSub: string },
): Promise<CreateUserResult> {
  const { ddb, tableName } = deps;
  const { dto, existingCognitoSub } = input;

  const emailLower = safeLowerCase(safeTrim(dto.email));
  const now = new Date().toISOString();
  const sk = userSk(dto.orgId, existingCognitoSub);

  const item = {
    [PK_NAME]: USER_PK,
    [SK_NAME]: sk,
    entityType: 'USER',
    orgId: dto.orgId,
    userId: existingCognitoSub,
    email: safeTrim(dto.email),
    emailLower,
    firstName: norm((dto as any).firstName),
    lastName: norm((dto as any).lastName),
    displayName: norm((dto as any).displayName),
    phone: normalizePhone((dto as any).phone),
    firstNameLower: norm((dto as any).firstName)?.toLowerCase(),
    lastNameLower: norm((dto as any).lastName)?.toLowerCase(),
    displayNameLower: norm((dto as any).displayName)?.toLowerCase(),
    phoneLower: normalizePhone((dto as any).phone)?.toLowerCase(),
    searchText: buildSearchText([
      emailLower,
      norm((dto as any).firstName),
      norm((dto as any).lastName),
      norm((dto as any).displayName),
      normalizePhone((dto as any).phone),
    ]),
    role: dto.role || 'VIEWER',
    status: dto.status ?? 'ACTIVE',
    cognitoUsername: emailLower,
    createdAt: now,
    updatedAt: now,
  };

  await ddb.send(
    new PutCommand({
      TableName: tableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(#pk) AND attribute_not_exists(#sk)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
    }),
  );

  return { userId: existingCognitoSub, cognitoUsername: emailLower, item };
}

export async function createUser(
  deps: CreateUserDeps,
  input: { dto: CreateUserDTO; userId: string; createdAtIso: string },
  options: CreateUserOptions = {},
): Promise<CreateUserResult> {
  const { ddb, cognito, tableName, userPoolId } = deps;
  const { dto, userId, createdAtIso } = input;

  const sendCognitoInvite = options.sendCognitoInvite ?? false;
  const markEmailVerified = options.markEmailVerified ?? true;

  const email = safeTrim(dto.email);
  const emailLower = safeLowerCase(email);
  const cognitoUsername = emailLower;

  const firstName = norm((dto as any).firstName);
  const lastName = norm((dto as any).lastName);
  const displayName = norm((dto as any).displayName);
  const phone = norm((dto as any).phone);

  const firstNameLower = firstName?.toLowerCase();
  const lastNameLower = lastName?.toLowerCase();
  const displayNameLower = displayName?.toLowerCase();

  const phoneNorm = normalizePhone(phone);
  const phoneLower = phoneNorm?.toLowerCase();

  const searchText = buildSearchText([emailLower, firstName, lastName, displayName, phoneNorm]);

  // 1) Cognito — create user and get the Cognito sub (UUID)
  // Note: We pass the fallback userId to custom attributes initially.
  // The actual userId stored in DynamoDB will be the Cognito sub.
  const { sub: cognitoSub } = await adminCreateUser(cognito, {
    userPoolId,
    username: cognitoUsername,
    email: emailLower,
    emailVerified: markEmailVerified,
    firstName,
    lastName,
    phone: phoneNorm,
    custom: {
      orgId: dto.orgId,
      userId, // Placeholder — will be overridden by cognitoSub below
      role: dto.role,
    },
    sendInvite: sendCognitoInvite,
  });

  // Use Cognito sub as the userId for DynamoDB (ensures token sub === DynamoDB userId)
  const effectiveUserId = cognitoSub || userId;

  // 2) Dynamo (rollback cognito on failure)
  const item = {
    [PK_NAME]: USER_PK,
    [SK_NAME]: userSk(dto.orgId, effectiveUserId),

    entityType: 'USER',

    orgId: dto.orgId,
    userId: effectiveUserId,

    // canonical fields
    email,
    firstName,
    lastName,
    displayName,
    phone,

    // search helpers (no indexes)
    emailLower,
    firstNameLower,
    lastNameLower,
    displayNameLower,
    phoneLower,
    searchText,

    role: dto.role,
    status: dto.status ?? 'ACTIVE',

    cognitoUsername,

    createdAt: createdAtIso,
    updatedAt: createdAtIso,
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(#pk) AND attribute_not_exists(#sk)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
      }),
    );
  } catch (ddbErr) {
    // best-effort rollback
    try {
      await adminDeleteUser(cognito, { userPoolId, username: cognitoUsername });
    } catch (rollbackErr) {
      console.error('Cognito rollback failed:', rollbackErr);
    }
    throw ddbErr;
  }

  return { userId: effectiveUserId, cognitoUsername, item };
}
