import { createItem, putItem, getItem, queryBySkPrefix, updateItem } from '@/helpers/db';
import { nowIso } from '@/helpers/date';
import type { NotificationItem, NotificationPreferences } from '@auto-rfp/core';
import { PK, NOTIFICATION_TTL_DAYS } from '@/constants/notification';

// ─── SK Builders ──────────────────────────────────────────────────────────────

export const buildNotificationSK = (
  orgId: string,
  userId: string,
  createdAt: string,
  notificationId: string,
): string => `${orgId}#${userId}#${createdAt}#${notificationId}`;

export const buildNotificationPrefsSK = (orgId: string, userId: string): string =>
  `${orgId}#${userId}`;

// ─── Notifications ────────────────────────────────────────────────────────────

export const createNotification = async (
  item: Omit<NotificationItem, 'createdAt' | 'updatedAt'>,
): Promise<NotificationItem> => {
  const now = nowIso();
  const ttl = Math.floor(Date.now() / 1000) + NOTIFICATION_TTL_DAYS * 86400;
  return createItem<NotificationItem & { ttl: number }>(
    PK.NOTIFICATION,
    buildNotificationSK(item.orgId, item.userId, now, item.notificationId),
    { ...item, ttl },
  ) as Promise<NotificationItem>;
};

export const listNotifications = async (
  orgId: string,
  userId: string,
  includeArchived = false,
): Promise<NotificationItem[]> => {
  const items = await queryBySkPrefix<NotificationItem>(
    PK.NOTIFICATION,
    `${orgId}#${userId}#`,
  );
  return includeArchived ? items : items.filter((n) => !n.archived);
};

export const markNotificationsRead = async (
  orgId: string,
  userId: string,
  notificationIds: string[],
): Promise<void> => {
  // Fetch all to get their full SKs (needed for updateItem)
  const all = await listNotifications(orgId, userId, true);
  const targets = all.filter((n) => notificationIds.includes(n.notificationId));
  await Promise.all(
    targets.map((n) =>
      updateItem(
        PK.NOTIFICATION,
        buildNotificationSK(orgId, userId, n.createdAt, n.notificationId),
        { read: true },
      ).catch((err: unknown) => {
        // Silently ignore conditional check failures (item may have been deleted/expired)
        const name = (err as { name?: string }).name;
        if (name !== 'ConditionalCheckFailedException') throw err;
      }),
    ),
  );
};

export const markAllNotificationsRead = async (
  orgId: string,
  userId: string,
): Promise<void> => {
  const unread = (await listNotifications(orgId, userId)).filter((n) => !n.read);
  await Promise.all(
    unread.map((n) =>
      updateItem(
        PK.NOTIFICATION,
        buildNotificationSK(orgId, userId, n.createdAt, n.notificationId),
        { read: true },
      ),
    ),
  );
};

export const archiveNotification = async (
  orgId: string,
  userId: string,
  notificationId: string,
): Promise<void> => {
  const all = await listNotifications(orgId, userId, true);
  const target = all.find((n) => n.notificationId === notificationId);
  if (!target) return;
  await updateItem(
    PK.NOTIFICATION,
    buildNotificationSK(orgId, userId, target.createdAt, notificationId),
    { archived: true },
  );
};

// ─── Preferences ──────────────────────────────────────────────────────────────

export const getNotificationPreferences = async (
  orgId: string,
  userId: string,
): Promise<NotificationPreferences | null> =>
  getItem<NotificationPreferences>(PK.NOTIFICATION_PREFS, buildNotificationPrefsSK(orgId, userId));

export const upsertNotificationPreferences = async (
  item: Omit<NotificationPreferences, 'createdAt' | 'updatedAt'>,
): Promise<NotificationPreferences> =>
  putItem<NotificationPreferences>(
    PK.NOTIFICATION_PREFS,
    buildNotificationPrefsSK(item.orgId, item.userId),
    item as NotificationPreferences,
  );
