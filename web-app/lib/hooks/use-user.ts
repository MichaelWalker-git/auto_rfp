'use client';

import useSWR from 'swr';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import { UserRole } from '@auto-rfp/shared';

const baseUrl = `${env.BASE_API_URL}/user`;

export type ListUsersParams = {
  search?: string;
  role?: string;
  status?: string;
  limit?: number;
  nextToken?: string;
};

export type UserListItem = {
  orgId: string;
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  phone?: string;
  role: UserRole;
  status: string;
  cognitoUsername?: string;
  createdAt: string;
  updatedAt: string;
};

export type ListUsersResponse = {
  items: UserListItem[];
  nextToken?: string;
  count: number;
};

export type CreateUserInput = {
  orgId: string;
  email: string;
  role: UserRole;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  phone?: string;
  status?: 'ACTIVE' | 'INACTIVE' | 'INVITED' | 'SUSPENDED';
  authSubject?: string;
};

export type CreateUserResponse = {
  orgId: string;
  userId: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  phone?: string;
  role: UserRole;
  status: string;
  cognitoUsername?: string;
  createdAt: string;
  updatedAt: string;
};

export type EditUserRolesInput = {
  orgId: string;
  userId: string;
  role: UserRole;
};

export type EditUserRolesResponse = CreateUserResponse & {
  cognito?: {
    username: string | null;
    updated: boolean;
  };
  user?: any;
};

export type DeleteUserInput = {
  orgId: string;
  userId: string;
};

export type DeleteUserResponse = {
  ok: true;
  orgId: string;
  userId: string;
  deleted: {
    dynamo: boolean;
    cognito: boolean;
  };
  cognitoUsername: string | null;
};

async function assertOk(res: Response) {
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed: ${res.status}`);
  }
}

async function listFetcher(url: string): Promise<ListUsersResponse> {
  const res = await authFetcher(url, { method: 'GET', cache: 'no-store' });
  await assertOk(res);
  return res.json();
}

function buildQueryString(params: Record<string, string | number | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : '';
}

/**
 * GET /user/get-users?orgId=...&search=...&role=...&status=...&limit=...&nextToken=...
 */
export function useUsersList(orgId: string, params: ListUsersParams) {
  const qs = buildQueryString({
    orgId,
    search: params.search?.trim() || undefined,
    role: params.role,
    status: params.status,
    limit: params.limit ?? 200,
    nextToken: params.nextToken,
  });

  const key = baseUrl && orgId ? `${baseUrl}/get-users${qs}` : null;

  const { data, error, isLoading, mutate } = useSWR<ListUsersResponse>(key, listFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: false,
  });

  return {
    data,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

/**
 * POST /user/create-user
 * Body: CreateUserInput
 */
export async function createUserApi(input: CreateUserInput): Promise<CreateUserResponse> {
  const res = await authFetcher(`${baseUrl}/create-user`, {
    method: 'POST',
    cache: 'no-store',
    body: JSON.stringify(input),
  });

  await assertOk(res);
  return res.json();
}

/**
 * POST /user/edit-user
 * Body: EditUserRolesInput
 *
 * For now, only roles change is available.
 */
export async function editUserRolesApi(
  input: EditUserRolesInput,
): Promise<EditUserRolesResponse> {
  const res = await authFetcher(`${baseUrl}/edit-user`, {
    method: 'PATCH',
    cache: 'no-store',
    body: JSON.stringify(input),
  });

  await assertOk(res);
  return res.json();
}

/**
 * DELETE /user/remove-user?orgId=...&userId=...
 *
 * If your backend expects POST instead of DELETE, switch method to POST and
 * pass body with {orgId,userId}.
 */
export async function deleteUserApi(input: DeleteUserInput): Promise<DeleteUserResponse> {
  const qs = buildQueryString({ orgId: input.orgId, userId: input.userId });

  const res = await authFetcher(`${baseUrl}/delete-user${qs}`, {
    method: 'DELETE',
    cache: 'no-store',
  });

  await assertOk(res);
  return res.json();
}