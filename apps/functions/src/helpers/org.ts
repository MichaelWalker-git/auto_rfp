import { createItem, docClient, getItem } from './db';
import { PK_NAME, SK_NAME } from '../constants/common';
import { ORG_PK } from '../constants/organization';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { requireEnv } from './env';
import { safeSplitAt, safeTrim } from './safe-string';
import { v4 as uuidv4 } from 'uuid';
import {
  OrganizationCreateRequest,
  OrganizationItem,
  ROLE_PERMISSIONS,
  UserRoleSchema,
  type UserRole,
} from '@auto-rfp/core';
import { USER_PK } from '../constants/user';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * Get an organization by its ID.
 * Returns null if not found.
 */
export const getOrganizationById = async (orgId: string): Promise<OrganizationItem | null> =>
  getItem<OrganizationItem>(ORG_PK, `ORG#${orgId}`);

export async function createOrganization(orgData: OrganizationCreateRequest): Promise<OrganizationItem> {
  const orgId = uuidv4();

  return await createItem<OrganizationItem>(
    ORG_PK,
    `ORG#${orgId}`,
    {
      ...orgData,
      id: orgId,
    } as any
  );
}

export async function listAllOrgIds(): Promise<string[]> {
  const orgIds: string[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk',
        ExpressionAttributeNames: { '#pk': PK_NAME },
        ExpressionAttributeValues: { ':pk': ORG_PK },
        ExclusiveStartKey,
      }),
    );

    for (const it of res.Items ?? []) {
      const rawSk = safeTrim((it as any)?.[SK_NAME]);
      // SK format: ORG#UUID - extract UUID at index 1
      const uuid = safeSplitAt(rawSk, '#', 1);
      if (uuid) orgIds.push(uuid);
    }

    ExclusiveStartKey = res.LastEvaluatedKey as any;
  } while (ExclusiveStartKey);

  return orgIds;
}

/**
 * An org member's email paired with the role that governs what they may do.
 *
 * `role` is optional because a stored user record predating the field, or written by a
 * path that omitted it, has none — callers must treat that as "no known role" and grant
 * nothing rather than defaulting to something permissive.
 */
export interface OrgMemberAccess {
  email: string;
  role?: UserRole;
}

/**
 * Ranks roles by breadth of access, so a duplicated email resolves to the strongest one.
 * Derived from `ROLE_PERMISSIONS` rather than hardcoded, so a role gaining or losing
 * permissions in core is reflected here without a second edit. An unknown or absent role
 * ranks below every real one.
 */
const rolePrecedence = (role?: UserRole): number =>
  role ? (ROLE_PERMISSIONS[role]?.length ?? 0) : -1;

/**
 * List an org's members with their roles.
 *
 * Distinct from `getOrgMemberEmails` in `google-drive.ts`, which projects only `email`
 * and therefore cannot tell an ADMIN from a VIEWER. Anything that grants access in an
 * external system needs the role, so that the grant can be capped by what the member
 * already holds inside AutoRFP.
 *
 * Emails are lowercased and de-duplicated; where the same address appears twice, the
 * more permissive role wins, since that is the access the person effectively has.
 */
export const listOrgMemberAccess = async (orgId: string): Promise<OrgMemberAccess[]> => {
  const byEmail = new Map<string, OrgMemberAccess>();
  let ExclusiveStartKey: Record<string, any> | undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME, '#role': 'role' },
        ExpressionAttributeValues: { ':pk': USER_PK, ':skPrefix': `ORG#${orgId}#USER#` },
        ProjectionExpression: 'email, #role',
        ExclusiveStartKey,
      }),
    );

    for (const item of res.Items ?? []) {
      const email = safeTrim((item as { email?: unknown }).email).toLowerCase();
      if (!email) continue;

      // Unrecognised role strings are dropped rather than trusted.
      const { success, data: role } = UserRoleSchema.safeParse((item as { role?: unknown }).role);
      const parsedRole = success ? role : undefined;

      const existing = byEmail.get(email);
      if (!existing || rolePrecedence(parsedRole) > rolePrecedence(existing.role)) {
        byEmail.set(email, parsedRole ? { email, role: parsedRole } : { email });
      }
    }

    ExclusiveStartKey = res.LastEvaluatedKey as any;
  } while (ExclusiveStartKey);

  return [...byEmail.values()];
};
