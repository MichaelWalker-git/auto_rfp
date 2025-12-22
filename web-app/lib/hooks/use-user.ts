'use client';

import useSWR from 'swr';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';

const baseUrl =`${env.BASE_API_URL}/user`;


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
  roles: string[];
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
  roles: string[]; // e.g. ['ADMIN'] | ['MEMBER']
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
  roles: string[];
  status: string;
  cognitoUsername?: string;
  createdAt: string;
  updatedAt: string;
};

async function listFetcher(url: string): Promise<ListUsersResponse> {
  const res = await authFetcher(url, {
    method: 'GET',
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed: ${res.status}`);
  }

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
 * GET /get-users?orgId=...&search=...&role=...&status=...&limit=...&nextToken=...
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
 * POST /create-user
 * Body: CreateUserInput
 */
export async function createUserApi(input: CreateUserInput): Promise<CreateUserResponse> {
  const res = await authFetcher(`${baseUrl}/create-user`, {
    method: 'POST',
    cache: 'no-store',
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed: ${res.status}`);
  }

  return res.json();
}
