import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

import { PK_NAME, SK_NAME } from '../constants/common';
import { USER_PK } from '../constants/user';

import type { CreateUserDTO } from '@auto-rfp/shared';
import { adminCreateUser, adminDeleteUser } from './cognito';
import { safeTrim, safeLowerCase } from './safe-string';

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

export const userSk = (orgId: string, userId: string) => `ORG#${orgId}#USER#${userId}`;

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
