import { DynamoDBDocumentClient, DeleteCommand, GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

import { PK_NAME, SK_NAME } from '../constants/common';
import { USER_PK } from '../constants/user';
import { OPPORTUNITY_PK } from '../constants/opportunity';

import type { CreateUserDTO, UserProjectAccess } from '@auto-rfp/core';
import { USER_PROJECT_PK, buildUserProjectSK } from '@auto-rfp/core';
import { adminCreateUser, adminDeleteUser, adminSetUserPassword, DEFAULT_TEMP_PASSWORD } from './cognito';
import { safeTrim, safeLowerCase } from './safe-string';
import { createItem, getItem, docClient } from './db';
import { requireEnv } from './env';
import { getAccessibleOrgIds } from './organization';

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
  input: { dto: CreateUserDTO; existingCognitoSub: string; previousUserId?: string },
): Promise<CreateUserResult> {
  const { ddb, tableName } = deps;
  const { dto, existingCognitoSub, previousUserId } = input;

  const emailLower = safeLowerCase(safeTrim(dto.email));
  const now = new Date().toISOString();
  const sk = userSk(dto.orgId, existingCognitoSub);

  // Check EMAIL_LOOKUP for a previously known userId if not provided
  let resolvedPreviousUserId = previousUserId;
  if (!resolvedPreviousUserId) {
    const lookupUserId = await getEmailLookup(emailLower);
    if (lookupUserId && lookupUserId !== existingCognitoSub) {
      resolvedPreviousUserId = lookupUserId;
    }
  }

  const item: Record<string, unknown> = {
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

  // Include previousUserId if the user was previously known under a different ID
  // This allows resolveUserNames to map stale createdBy/updatedBy references
  if (resolvedPreviousUserId) {
    item.previousUserId = resolvedPreviousUserId;
  }

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
 * Each stale record migration uses TransactWriteItems (atomic delete + put)
 * so a record is never lost if one operation fails.
 *
 * Cost on happy path (no mismatch): 1 GetItem. Only when mismatch detected:
 * 1 PutItem (lookup) + 1 GSI Query (old userId) + N TransactWrite pairs.
 */
export const syncUserIdAcrossOrgs = async (
  email: string,
  correctUserId: string,
): Promise<{ updated: number; orgs: string[] }> => {
  const emailLower = safeLowerCase(safeTrim(email));

  // 1. Check the lookup item for the previously known userId
  const previousUserId = await getEmailLookup(emailLower);

  // 2. If no previous record or same userId, nothing to sync
  if (!previousUserId || previousUserId === correctUserId) {
    // Only write the lookup if it's missing (avoid unnecessary PutItem on happy path)
    if (!previousUserId) {
      await upsertEmailLookup(emailLower, correctUserId);
    }
    return { updated: 0, orgs: [] };
  }

  // 3. userId changed — update the lookup first
  await upsertEmailLookup(emailLower, correctUserId);

  console.log(`[syncUserIdAcrossOrgs] userId changed for ${emailLower}: ${previousUserId} → ${correctUserId}`);

  // 4. Query the GSI for USER records with the OLD userId
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

  // Even if no stale USER records found, we must sync USER_PROJECT and OPPORTUNITY
  // The USER records might have been deleted, but related records still reference the old userId
  if (staleRecords.length === 0) {
    console.log(`[syncUserIdAcrossOrgs] No stale USER records found for ${previousUserId}, syncing related records anyway`);
    await syncUserProjectRecords(previousUserId, correctUserId);
    // For opportunities, we need all orgs this user currently belongs to
    const currentOrgs = await getAccessibleOrgIds(correctUserId);
    if (currentOrgs.length > 0) {
      await syncOpportunityAssignments(previousUserId, correctUserId, currentOrgs);
    }
    return { updated: 0, orgs: currentOrgs };
  }

  // 5. Atomically migrate each stale record (delete old + put new in a transaction)
  const updatedOrgs: string[] = [];

  for (const record of staleRecords) {
    const oldSk = record[SK_NAME] as string;
    // Fallback: parse orgId from SK if not stored as a field (legacy records)
    // SK format: ORG#{orgId}#USER#{userId}
    const orgId = (record['orgId'] as string) ?? oldSk.match(/^ORG#([^#]+)#USER#/)?.[1];
    if (!orgId) {
      console.warn(`[syncUserIdAcrossOrgs] Skipping record with unparseable SK: ${oldSk}`);
      continue;
    }
    const newSk = userSk(orgId, correctUserId);

    // Skip if a record with the new SK already exists (don't overwrite a correct record)
    if (oldSk === newSk) continue;

    const { [PK_NAME]: _pk, [SK_NAME]: _sk, ...rest } = record;

    try {
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Delete: {
                TableName: DB_TABLE_NAME,
                Key: { [PK_NAME]: USER_PK, [SK_NAME]: oldSk },
                ConditionExpression: 'attribute_exists(#pk)',
                ExpressionAttributeNames: { '#pk': PK_NAME },
              },
            },
            {
              Put: {
                TableName: DB_TABLE_NAME,
                Item: {
                  ...rest,
                  [PK_NAME]: USER_PK,
                  [SK_NAME]: newSk,
                  userId: correctUserId,
                  previousUserId,
                  updatedAt: new Date().toISOString(),
                },
                // Don't overwrite if a correct record already exists at this SK
                ConditionExpression: 'attribute_not_exists(#pk)',
                ExpressionAttributeNames: { '#pk': PK_NAME },
              },
            },
          ],
        }),
      );

      updatedOrgs.push(orgId);
      console.log(`[syncUserIdAcrossOrgs] Migrated ${emailLower} in org ${orgId}: ${previousUserId} → ${correctUserId}`);
    } catch (err: unknown) {
      const errName = (err as { name?: string })?.name;
      if (errName === 'TransactionCanceledException') {
        // Either old record already gone or new record already exists — both are fine
        console.log(`[syncUserIdAcrossOrgs] Skipped ${emailLower} in org ${orgId} (already migrated or conflict)`);
      } else {
        console.error(`[syncUserIdAcrossOrgs] Failed to migrate ${emailLower} in org ${orgId}:`, err);
      }
    }
  }

  // 6. Sync USER_PROJECT and OPPORTUNITY assignments
  if (updatedOrgs.length > 0) {
    await syncUserProjectRecords(previousUserId, correctUserId);
    await syncOpportunityAssignments(previousUserId, correctUserId, updatedOrgs);
  }

  return { updated: updatedOrgs.length, orgs: updatedOrgs };
};

/**
 * Migrate USER_PROJECT records from old userId to new userId.
 * SK format: `{userId}#{projectId}` — must delete old + create new.
 */
export const syncUserProjectRecords = async (
  oldUserId: string,
  newUserId: string,
): Promise<{ migrated: number }> => {
  const staleRecords: Record<string, unknown>[] = [];
  let ExclusiveStartKey: Record<string, unknown> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
        ExpressionAttributeValues: { ':pk': USER_PROJECT_PK, ':skPrefix': `${oldUserId}#` },
        ExclusiveStartKey,
      }),
    );
    staleRecords.push(...(res.Items ?? []));
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  if (staleRecords.length === 0) return { migrated: 0 };

  let migrated = 0;
  for (const record of staleRecords) {
    const projectId = record['projectId'] as string;
    const oldSk = buildUserProjectSK(oldUserId, projectId);
    const newSk = buildUserProjectSK(newUserId, projectId);

    try {
      await docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            { Delete: { TableName: DB_TABLE_NAME, Key: { [PK_NAME]: USER_PROJECT_PK, [SK_NAME]: oldSk } } },
            {
              Put: {
                TableName: DB_TABLE_NAME,
                Item: { ...record, [PK_NAME]: USER_PROJECT_PK, [SK_NAME]: newSk, userId: newUserId },
                ConditionExpression: 'attribute_not_exists(#pk)',
                ExpressionAttributeNames: { '#pk': PK_NAME },
              },
            },
          ],
        }),
      );
      migrated++;
    } catch (err) {
      console.error(`[syncUserProjectRecords] Failed to migrate project ${projectId}:`, err);
    }
  }

  console.log(`[syncUserProjectRecords] Migrated ${migrated} USER_PROJECT records: ${oldUserId} → ${newUserId}`);
  return { migrated };
};

/**
 * Update OPPORTUNITY records where assigneeId = oldUserId.
 * Also updates assigneeName to the user's current display name.
 */
export const syncOpportunityAssignments = async (
  oldUserId: string,
  newUserId: string,
  orgs: string[],
): Promise<{ updated: number }> => {
  let totalUpdated = 0;

  for (const orgId of orgs) {
    // Look up the user's display name for this org
    const user = await getUserByOrgAndId(orgId, newUserId);
    let assigneeName: string | null = null;
    if (user) {
      const firstName = user.firstName ?? '';
      const lastName = user.lastName ?? '';
      const fullName = [firstName, lastName].filter(Boolean).join(' ');
      assigneeName = user.displayName ?? (fullName || user.email);
    }

    let ExclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const res = await docClient.send(
        new QueryCommand({
          TableName: DB_TABLE_NAME,
          KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
          FilterExpression: '#assigneeId = :oldUserId',
          ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME, '#assigneeId': 'assigneeId' },
          ExpressionAttributeValues: { ':pk': OPPORTUNITY_PK, ':skPrefix': `${orgId}#`, ':oldUserId': oldUserId },
          ExclusiveStartKey,
        }),
      );

      for (const item of res.Items ?? []) {
        const sk = item[SK_NAME] as string;
        try {
          // Update both assigneeId AND assigneeName
          const updateExpression = assigneeName
            ? 'SET #assigneeId = :newUserId, #assigneeName = :assigneeName, #updatedAt = :now'
            : 'SET #assigneeId = :newUserId, #updatedAt = :now';
          const expressionAttributeNames: Record<string, string> = {
            '#assigneeId': 'assigneeId',
            '#updatedAt': 'updatedAt',
          };
          const expressionAttributeValues: Record<string, unknown> = {
            ':newUserId': newUserId,
            ':now': new Date().toISOString(),
          };
          if (assigneeName) {
            expressionAttributeNames['#assigneeName'] = 'assigneeName';
            expressionAttributeValues[':assigneeName'] = assigneeName;
          }

          await docClient.send(
            new UpdateCommand({
              TableName: DB_TABLE_NAME,
              Key: { [PK_NAME]: OPPORTUNITY_PK, [SK_NAME]: sk },
              UpdateExpression: updateExpression,
              ExpressionAttributeNames: expressionAttributeNames,
              ExpressionAttributeValues: expressionAttributeValues,
            }),
          );
          totalUpdated++;
        } catch (err) {
          console.error(`[syncOpportunityAssignments] Failed to update ${sk}:`, err);
        }
      }
      ExclusiveStartKey = res.LastEvaluatedKey;
    } while (ExclusiveStartKey);
  }

  console.log(`[syncOpportunityAssignments] Updated ${totalUpdated} opportunities: assigneeId ${oldUserId} → ${newUserId}`);
  return { updated: totalUpdated };
};
