import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

import { PK_NAME, SK_NAME } from '../constants/common';
import { USER_PK } from '../constants/user';

import type { CreateUserDTO } from '@auto-rfp/core';
import { adminCreateUser, adminDeleteUser, adminSetUserPassword, DEFAULT_TEMP_PASSWORD } from './cognito';
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
    position: norm((dto as any).position),
    firstNameLower: norm((dto as any).firstName)?.toLowerCase(),
    lastNameLower: norm((dto as any).lastName)?.toLowerCase(),
    displayNameLower: norm((dto as any).displayName)?.toLowerCase(),
    phoneLower: normalizePhone((dto as any).phone)?.toLowerCase(),
    positionLower: norm((dto as any).position)?.toLowerCase(),
    searchText: buildSearchText([
      emailLower,
      norm((dto as any).firstName),
      norm((dto as any).lastName),
      norm((dto as any).displayName),
      normalizePhone((dto as any).phone),
      norm((dto as any).position),
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
  const position = norm((dto as any).position);

  const firstNameLower = firstName?.toLowerCase();
  const lastNameLower = lastName?.toLowerCase();
  const displayNameLower = displayName?.toLowerCase();
  const positionLower = position?.toLowerCase();

  const phoneNorm = normalizePhone(phone);
  const phoneLower = phoneNorm?.toLowerCase();

  const searchText = buildSearchText([emailLower, firstName, lastName, displayName, phoneNorm, position]);

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

  // 1b) Set the known default temporary password (forces change on first login).
  // This replaces Cognito's random temp password with a simple, memorable one.
  await adminSetUserPassword(cognito, {
    userPoolId,
    username: cognitoUsername,
    password: DEFAULT_TEMP_PASSWORD,
    permanent: false, // FORCE_CHANGE_PASSWORD — user must change on first login
  });

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
    position,

    // search helpers (no indexes)
    emailLower,
    firstNameLower,
    lastNameLower,
    displayNameLower,
    phoneLower,
    positionLower,
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

/**
 * List all users with ADMIN role in an organization.
 * Used for bulk-granting project access to all admins.
 */
export const listOrgAdmins = async (
  orgId: string,
): Promise<Array<{ userId: string; email: string }>> => {
  const admins: Array<{ userId: string; email: string }> = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        FilterExpression: '#role = :adminRole',
        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
          '#role': 'role',
        },
        ExpressionAttributeValues: {
          ':pk': USER_PK,
          ':skPrefix': userSk(orgId, ''),
          ':adminRole': 'ADMIN',
        },
        ProjectionExpression: 'userId, email',
        ExclusiveStartKey,
      }),
    );
    for (const item of res.Items ?? []) {
      if (item['userId'] && item['email']) {
        admins.push({ userId: item['userId'] as string, email: item['email'] as string });
      }
    }
    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (ExclusiveStartKey);

  return admins;
};

const EMAIL_LOOKUP_PK = 'EMAIL_LOOKUP';
const GSI_BY_USER_ID = 'byUserId';

/**
 * Upsert an EMAIL_LOOKUP item that maps emailLower → current userId.
 * Used by syncUserIdAcrossOrgs to avoid full-table scans.
 */
const upsertEmailLookup = async (emailLower: string, userId: string): Promise<void> => {
  await docClient.send(
    new PutCommand({
      TableName: DB_TABLE_NAME,
      Item: {
        [PK_NAME]: EMAIL_LOOKUP_PK,
        [SK_NAME]: emailLower,
        userId,
        updatedAt: new Date().toISOString(),
      },
    }),
  );
};

/**
 * Get the previously stored userId for an email.
 * Returns null if no lookup item exists (first-time user).
 */
const getEmailLookup = async (emailLower: string): Promise<string | null> => {
  const res = await docClient.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: EMAIL_LOOKUP_PK, [SK_NAME]: emailLower },
      ProjectionExpression: 'userId',
    }),
  );
  return (res.Item?.userId as string) ?? null;
};

/**
 * Sync userId across all orgs for a given email.
 *
 * Uses an EMAIL_LOOKUP item to track the last-known userId for each email.
 * When the Cognito sub changes (user deleted + recreated), this detects the
 * mismatch and queries the byUserId GSI for the OLD userId to find stale
 * records — no full-table scan needed.
 *
 * Cost: 1 GetItem (lookup) + 1 PutItem (upsert lookup). Only when a mismatch
 * is detected: 1 GSI Query (old userId) + N delete/put pairs for stale records.
 */
export const syncUserIdAcrossOrgs = async (
  email: string,
  correctUserId: string,
): Promise<{ updated: number; orgs: string[] }> => {
  const emailLower = safeLowerCase(safeTrim(email));

  // 1. Check the lookup item for the previously known userId
  const previousUserId = await getEmailLookup(emailLower);

  // 2. Always upsert the lookup to keep it current
  await upsertEmailLookup(emailLower, correctUserId);

  // 3. If no previous record or same userId, nothing to sync
  if (!previousUserId || previousUserId === correctUserId) {
    return { updated: 0, orgs: [] };
  }

  // 4. userId changed — query the GSI for USER records with the OLD userId
  console.log(`[syncUserIdAcrossOrgs] userId changed for ${emailLower}: ${previousUserId} → ${correctUserId}`);

  const staleRecords: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        IndexName: GSI_BY_USER_ID,
        KeyConditionExpression: '#userId = :userId AND #pk = :pk',
        ExpressionAttributeNames: { '#userId': 'userId', '#pk': PK_NAME },
        ExpressionAttributeValues: { ':userId': previousUserId, ':pk': USER_PK },
        ExclusiveStartKey,
      }),
    );
    staleRecords.push(...(res.Items ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  if (staleRecords.length === 0) {
    return { updated: 0, orgs: [] };
  }

  // 5. Re-create each stale record with the correct userId + sort_key
  const updatedOrgs: string[] = [];

  for (const record of staleRecords) {
    const orgId = record['orgId'] as string;
    const oldSk = record[SK_NAME] as string;
    const newSk = userSk(orgId, correctUserId);

    try {
      // Delete the old record (stale userId in sort_key)
      await docClient.send(
        new DeleteCommand({
          TableName: DB_TABLE_NAME,
          Key: { [PK_NAME]: USER_PK, [SK_NAME]: oldSk },
        }),
      );

      // Create new record with correct userId + sort_key
      const { [PK_NAME]: _pk, [SK_NAME]: _sk, ...rest } = record;
      await docClient.send(
        new PutCommand({
          TableName: DB_TABLE_NAME,
          Item: {
            ...rest,
            [PK_NAME]: USER_PK,
            [SK_NAME]: newSk,
            userId: correctUserId,
            updatedAt: new Date().toISOString(),
          },
        }),
      );

      updatedOrgs.push(orgId);
      console.log(`[syncUserIdAcrossOrgs] Updated ${emailLower} in org ${orgId}: ${previousUserId} → ${correctUserId}`);
    } catch (err) {
      console.error(`[syncUserIdAcrossOrgs] Failed to update ${emailLower} in org ${orgId}:`, err);
    }
  }

  return { updated: updatedOrgs.length, orgs: updatedOrgs };
};
