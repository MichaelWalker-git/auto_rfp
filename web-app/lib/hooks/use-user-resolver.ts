'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { env } from '@/lib/env';
import { authFetcher } from '@/lib/auth/auth-fetcher';

interface UserInfo {
  userId: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  email?: string;
}

type UserMap = Record<string, string>;

/**
 * Hook that resolves user IDs (Cognito subs) to display names.
 * Fetches the org's user list once and caches it.
 * Returns a function `resolveUser(userId)` that returns the display name or a truncated ID.
 */
export function useUserResolver(orgId: string | null) {
  const [userMap, setUserMap] = useState<UserMap>({});
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!orgId || fetchedRef.current) return;
    fetchedRef.current = true;

    (async () => {
      try {
        const res = await authFetcher(
          `${env.BASE_API_URL}/user/get-users?orgId=${encodeURIComponent(orgId)}`,
        );
        if (!res.ok) return;

        const data = await res.json();
        const users: UserInfo[] = Array.isArray(data) ? data : data?.users ?? data?.items ?? [];

        const map: UserMap = {};
        for (const u of users) {
          const name =
            u.displayName ||
            [u.firstName, u.lastName].filter(Boolean).join(' ') ||
            u.email ||
            u.userId;
          map[u.userId] = name;
        }
        setUserMap(map);
      } catch {
        // Silently fail — user names just won't resolve
      }
    })();
  }, [orgId]);

  const resolveUser = useCallback(
    (userId: string | undefined | null): string => {
      if (!userId) return '';
      if (userMap[userId]) return userMap[userId];
      // Truncate UUID for display
      return userId.length > 8 ? `${userId.slice(0, 8)}…` : userId;
    },
    [userMap],
  );

  return { resolveUser, userMap };
}