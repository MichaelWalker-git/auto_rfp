'use client';

import { useApi, apiMutate, buildApiUrl } from './api-helpers';
import type {
  UserRole,
  UserListItem,
  ListUsersResponse,
  CreateUserDTO,
  CreateUserResponse,
  EditUserRoleRequest,
  EditUserRequest,
  EditUserResponse,
  DeleteUserInput,
  DeleteUserResponse,
} from '@auto-rfp/shared';

// Legacy response type alias (extends CreateUserResponse with cognito info)
export type EditUserRolesResponse = CreateUserResponse & {
  cognito?: {
    username: string | null;
    updated: boolean;
  };
  user?: unknown;
};

export type ListUsersParams = {
  search?: string;
  role?: string;
  status?: string;
  limit?: number;
  nextToken?: string;
};

// ─── GET Hook ───

export function useUsersList(orgId: string, params: ListUsersParams) {
  const url = buildApiUrl('user/get-users', {
    orgId,
    search: params.search?.trim() || undefined,
    role: params.role,
    status: params.status,
    limit: params.limit ?? 200,
    nextToken: params.nextToken,
  });

  return useApi<ListUsersResponse>(
    orgId ? ['users', orgId, params.search, params.role, params.status, params.limit, params.nextToken] : null,
    orgId ? url : null,
    { keepPreviousData: true },
  );
}

// ─── API Functions (non-hook, for imperative calls) ───

export async function createUserApi(input: CreateUserDTO): Promise<CreateUserResponse> {
  return apiMutate<CreateUserResponse>(buildApiUrl('user/create-user'), 'POST', input);
}

export async function editUserRolesApi(input: EditUserRoleRequest): Promise<EditUserRolesResponse> {
  return apiMutate<EditUserRolesResponse>(buildApiUrl('user/edit-user'), 'PATCH', input);
}

export async function editUserApi(input: EditUserRequest): Promise<EditUserResponse> {
  return apiMutate<EditUserResponse>(buildApiUrl('user/edit-user'), 'PATCH', input);
}

export async function deleteUserApi(input: DeleteUserInput): Promise<DeleteUserResponse> {
  return apiMutate<DeleteUserResponse>(
    buildApiUrl('user/delete-user', { orgId: input.orgId, userId: input.userId }),
    'DELETE',
  );
}

// ─── Multi-Org Management API Functions ───

export async function addUserToOrganizationApi(input: {
  userId: string;
  targetOrgId: string;
  orgId?: string;
  role?: string;
}): Promise<{ message: string; userId: string; targetOrgId: string; role: string }> {
  return apiMutate(buildApiUrl('user/add-to-organization', { orgId: input.orgId }), 'POST', input);
}

export async function removeUserFromOrganizationApi(input: {
  userId: string;
  targetOrgId: string;
  orgId?: string;
}): Promise<{ message: string; userId: string; targetOrgId: string; remainingMemberships: number }> {
  return apiMutate(buildApiUrl('user/remove-from-organization', { orgId: input.orgId }), 'POST', input);
}

// ─── KB Access Control API Functions ───

export async function grantKBAccessApi(input: {
  userId: string;
  kbId: string;
  orgId?: string;
  accessLevel?: 'read' | 'write' | 'admin';
}): Promise<unknown> {
  return apiMutate(buildApiUrl('knowledgebase/grant-access', { orgId: input.orgId }), 'POST', input);
}

export function useKBAccessUsers(kbId: string | null, orgId: string | null) {
  return useApi<{ users: Array<{ userId: string; kbId: string; orgId: string; accessLevel: string; grantedAt: string }> }>(
    kbId && orgId ? ['kb-access-users', kbId, orgId] : null,
    kbId && orgId ? buildApiUrl('knowledgebase/get-access-users', { kbId, orgId }) : null,
  );
}

/** Fetch all KB access records for a specific user within an org */
export function useUserKBAccess(userId: string | null, orgId: string | null) {
  return useApi<{ records: Array<{ userId: string; kbId: string; orgId: string; accessLevel: string; grantedAt: string }> }>(
    userId && orgId ? ['user-kb-access', userId, orgId] : null,
    userId && orgId ? buildApiUrl('knowledgebase/get-user-kb-access', { userId, orgId }) : null,
  );
}

export async function revokeKBAccessApi(input: {
  userId: string;
  kbId: string;
  orgId?: string;
}): Promise<unknown> {
  return apiMutate(buildApiUrl('knowledgebase/revoke-access', { orgId: input.orgId }), 'POST', input);
}
