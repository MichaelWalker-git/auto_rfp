'use client';

import useSWR from 'swr';
import useSWRMutation from 'swr/mutation';
import { authFetcher } from '@/lib/auth/auth-fetcher';
import { env } from '@/lib/env';
import type { NotificationsResponse } from '@auto-rfp/core';

const BASE = `${env.BASE_API_URL}/notification`;

const fetcher = async (url: string): Promise<NotificationsResponse> => {
  const res = await authFetcher(url);
  if (!res.ok) throw new Error('Failed to fetch notifications');
  return res.json();
};

export const useNotifications = (orgId: string | null, includeArchived = false) => {
  const params = new URLSearchParams();
  if (orgId) params.set('orgId', orgId);
  if (includeArchived) params.set('includeArchived', 'true');

  const key = orgId ? `${BASE}/list?${params.toString()}` : null;

  const { data, error, isLoading, mutate } = useSWR<NotificationsResponse>(key, fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });

  const markRead = useSWRMutation(
    `${BASE}/mark-read`,
    async (url: string, { arg }: { arg: { orgId: string; notificationIds: string[] } }) => {
      // Optimistic update — mark as read in local cache immediately
      await mutate(
        (current) => {
          if (!current) return current;
          const updated = current.items.map((n) =>
            arg.notificationIds.includes(n.notificationId) ? { ...n, read: true } : n,
          );
          const unreadCount = updated.filter((n) => !n.read).length;
          return { ...current, items: updated, unreadCount };
        },
        { revalidate: false },
      );

      // Fire API in background — best-effort
      authFetcher(url, { method: 'POST', body: JSON.stringify(arg) })
        .then((res) => { if (res.ok) mutate(); })
        .catch(() => { /* silently ignore */ });
    },
  );

  const markAllRead = useSWRMutation(
    `${BASE}/mark-all-read`,
    async (_url: string, { arg }: { arg: { orgId: string } }) => {
      // Optimistic update
      await mutate(
        (current) => {
          if (!current) return current;
          const updated = current.items.map((n) => ({ ...n, read: true }));
          return { ...current, items: updated, unreadCount: 0 };
        },
        { revalidate: false },
      );

      authFetcher(`${BASE}/mark-all-read?orgId=${arg.orgId}`, { method: 'POST' })
        .then((res) => { if (res.ok) mutate(); })
        .catch(() => { /* silently ignore */ });
    },
  );

  const archive = useSWRMutation(
    `${BASE}/archive`,
    async (url: string, { arg }: { arg: { orgId: string; notificationId: string } }) => {
      // Optimistic update — remove from list immediately
      await mutate(
        (current) => {
          if (!current) return current;
          const updated = current.items.filter((n) => n.notificationId !== arg.notificationId);
          const unreadCount = updated.filter((n) => !n.read).length;
          return { ...current, items: updated, count: updated.length, unreadCount };
        },
        { revalidate: false },
      );

      authFetcher(url, { method: 'DELETE', body: JSON.stringify(arg) })
        .then((res) => { if (res.ok) mutate(); })
        .catch(() => { /* silently ignore */ });
    },
  );

  return {
    notifications: data?.items ?? [],
    unreadCount: data?.unreadCount ?? 0,
    count: data?.count ?? 0,
    isLoading,
    isError: !!error,
    mutate,
    markRead,
    markAllRead,
    archive,
  };
};
