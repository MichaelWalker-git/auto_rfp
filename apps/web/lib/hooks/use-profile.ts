'use client';

import useSWR from 'swr';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import { useAuth } from '@/components/AuthProvider';
import { editUserApi } from '@/lib/hooks/use-user';
import type { UserListItem, EditProfileDTO } from '@auto-rfp/core';

const baseUrl = `${env.BASE_API_URL}/user`;

export type UserProfile = UserListItem;

async function profileFetcher(url: string): Promise<UserProfile | null> {
  const res = await authFetcher(url, { method: 'GET', cache: 'no-store' });
  if (!res.ok) {
    if (res.status === 404) return null;
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed: ${res.status}`);
  }
  const data = await res.json();
  return data.user ?? null;
}

/**
 * Fetches the current user's profile using the dedicated get-user endpoint.
 * Uses the Cognito sub (userId) for direct lookup when available,
 * falls back to email search.
 */
export function useProfile() {
  const { orgId, email, userSub, isAuthed } = useAuth();

  // Use userId (Cognito sub) for direct DynamoDB GetItem
  const key = isAuthed && orgId && userSub
    ? `${baseUrl}/get-user?orgId=${orgId}&userId=${userSub}`
    : null;

  const { data, error, isLoading, mutate } = useSWR<UserProfile | null>(key, profileFetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  });

  return {
    profile: data ?? null,
    isLoading,
    isError: !!error,
    error,
    mutate,
  };
}

/**
 * Updates the current user's profile (firstName, lastName, displayName, phone).
 * Email is immutable. Uses the standard edit-user endpoint.
 */
export async function editProfileApi(
  orgId: string,
  userId: string,
  input: EditProfileDTO,
): Promise<void> {
  await editUserApi({
    orgId,
    userId,
    ...input,
  });
}