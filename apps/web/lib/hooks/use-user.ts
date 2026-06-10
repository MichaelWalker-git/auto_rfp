'use client';

import { useApi, apiMutate, buildApiUrl, apiFetcher } from './api-helpers';
import useSWR, { mutate as globalMutate } from 'swr';
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
  ResendTempPasswordRequest,
  ResendTempPasswordResponse,
} from '@auto-rfp/core';

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

// ─── Single User Hook ───

interface GetUserResponse {
  ok: boolean;
  user: UserListItem;
}

/**
 * Fetch a single user by orgId and userId.
 * Uses the dedicated get-user endpoint for direct lookup (no cache dependencies).
 */
export function useUser(orgId: string | null, userId: string | null) {
  const url = orgId && userId
    ? buildApiUrl('user/get-user', { orgId, userId })
    : null;

  const { data, error, isLoading, mutate } = useSWR<GetUserResponse>(
    orgId && userId ? ['user', orgId, userId] : null,
    url ? () => apiFetcher<GetUserResponse>(url) : null,
    { revalidateOnFocus: false },
  );

  return {
    user: data?.user ?? null,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

// ─── Users List Hook ───

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
    {
      keepPreviousData: true,
      revalidateOnFocus: true,  // Enable focus revalidation for user lists to catch cross-tab mutations
    },
  );
}

// ─── API Functions (non-hook, for imperative calls) ───

/**
 * Invalidates user list caches for a specific organization.
 * Use this after creating/updating/deleting users to ensure all components see fresh data.
 */
export async function invalidateUserCaches(orgId: string): Promise<void> {
  await globalMutate(
    (key) => Array.isArray(key) && key[0] === 'users' && key[1] === orgId,
    undefined,
    { revalidate: true }
  );
}

export async function createUserApi(input: CreateUserDTO): Promise<CreateUserResponse> {
  const result = await apiMutate<CreateUserResponse>(buildApiUrl('user/create-user'), 'POST', input);
  // Auto-invalidate user caches after successful creation
  invalidateUserCaches(input.orgId).catch(console.error);
  return result;
}

export async function editUserRolesApi(input: EditUserRoleRequest): Promise<EditUserRolesResponse> {
  const result = await apiMutate<EditUserRolesResponse>(buildApiUrl('user/edit-user'), 'PATCH', input);
  // Auto-invalidate user caches after successful edit
  invalidateUserCaches(input.orgId).catch(console.error);
  return result;
}

export async function editUserApi(input: EditUserRequest): Promise<EditUserResponse> {
  const result = await apiMutate<EditUserResponse>(buildApiUrl('user/edit-user'), 'PATCH', input);
  // Auto-invalidate user caches after successful edit
  invalidateUserCaches(input.orgId).catch(console.error);
  return result;
}

export async function deleteUserApi(input: DeleteUserInput): Promise<DeleteUserResponse> {
  const result = await apiMutate<DeleteUserResponse>(
    buildApiUrl('user/delete-user', { orgId: input.orgId, userId: input.userId }),
    'DELETE',
  );
  // Auto-invalidate user caches after successful deletion
  invalidateUserCaches(input.orgId).catch(console.error);
  return result;
}

export async function resendTempPasswordApi(input: ResendTempPasswordRequest): Promise<ResendTempPasswordResponse> {
  return apiMutate<ResendTempPasswordResponse>(buildApiUrl('user/resend-temp-password'), 'POST', input);
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
