'use client';

import useSWR from 'swr';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import { useAuth } from '@/components/AuthProvider';
import { editUserApi, type UserListItem, type ListUsersResponse } from '@/lib/hooks/use-user';
import type { EditProfileDTO } from '@auto-rfp/shared';

const baseUrl = `${env.BASE_API_URL}/user`;

export type UserProfile = UserListItem;

async function profileFetcher(url: string): Promise<UserProfile | null> {
  const res = await authFetcher(url, { method: 'GET', cache: 'no-store' });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Request failed: ${res.status}`);
  }
  const data: ListUsersResponse = await res.json();
  // The list should contain the current user; we pick the first item
  return data.items?.[0] ?? null;
}

/**
 * Fetches the current user's profile by querying the org users list
 * filtered to limit=1 (the user's own record is found by the backend).
 */
export function useProfile() {
  const { orgId, email, isAuthed } = useAuth();

  // Use the get-users endpoint with search=email to find the current user
  const key =
    isAuthed && orgId && email
      ? `${baseUrl}/get-users?orgId=${orgId}&search=${encodeURIComponent(email)}&limit=1`
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