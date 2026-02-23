'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { NotificationPreferences, UpdateNotificationPreferencesDTO } from '@auto-rfp/core';

const BASE = `${env.BASE_API_URL}/notification`;

export const useNotificationPreferences = (orgId: string | null) => {
  const key = orgId ? `${BASE}/preferences?orgId=${orgId}` : null;

  const { data, error, isLoading, mutate } = useSWR<NotificationPreferences>(
    key,
    async (url: string) => {
      const res = await authFetcher(url);
      if (!res.ok) throw new Error('Failed to fetch preferences');
      return res.json();
    },
  );

  const update = useSWRMutation(
    `${BASE}/preferences`,
    async (url: string, { arg }: { arg: UpdateNotificationPreferencesDTO }) => {
      const res = await authFetcher(url, { method: 'PUT', body: JSON.stringify(arg) });
      if (!res.ok) throw new Error('Failed to update preferences');
      const updated = await res.json();
      await mutate(updated);
      return updated;
    },
  );

  return {
    preferences: data ?? null,
    isLoading,
    isError: !!error,
    update,
    mutate,
  };
};
