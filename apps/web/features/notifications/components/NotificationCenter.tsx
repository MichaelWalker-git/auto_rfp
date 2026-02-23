'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Settings } from 'lucide-react';
import { NotificationItem } from './NotificationItem';
import { NotificationPreferencesForm } from './NotificationPreferencesForm';
import { useNotifications } from '../hooks/useNotifications';

interface NotificationCenterProps {
  orgId: string;
}

export const NotificationCenter = ({ orgId }: NotificationCenterProps) => {
  const { notifications, unreadCount, isLoading, markRead, markAllRead, archive } = useNotifications(orgId);
  const [showPrefs, setShowPrefs] = useState(false);

  return (
    <div className="flex flex-col">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-sm">Notifications</h3>
          {unreadCount > 0 && (
            <span className="text-xs bg-indigo-100 text-indigo-700 font-medium px-1.5 py-0.5 rounded-full">
              {unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-indigo-500 h-7 px-2"
              onClick={() => markAllRead.trigger({ orgId })}
            >
              Mark all read
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={`h-7 w-7 ${showPrefs ? 'text-indigo-500 bg-indigo-50' : 'text-slate-400'}`}
            onClick={() => setShowPrefs((v) => !v)}
            title="Notification settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Preferences panel ── */}
      {showPrefs ? (
        <ScrollArea className="h-96">
          <div className="p-4">
            <NotificationPreferencesForm orgId={orgId} />
          </div>
        </ScrollArea>
      ) : (
        <>
          {/* ── Notification list ── */}
          <ScrollArea className="h-[360px]">
            {isLoading ? (
              <div className="p-4 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 gap-2 text-slate-400">
                <span className="text-2xl">🔔</span>
                <p className="text-sm">No notifications yet</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {notifications.map((n) => (
                  <NotificationItem
                    key={n.notificationId}
                    notification={n}
                    orgId={orgId}
                    onArchive={() => archive.trigger({ orgId, notificationId: n.notificationId })}
                    onRead={(id) => markRead.trigger({ orgId, notificationIds: [id] })}
                  />
                ))}
              </div>
            )}
          </ScrollArea>

          {/* ── Footer ── */}
          {notifications.length > 0 && (
            <>
              <Separator />
              <div className="px-4 py-2 flex justify-center">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-slate-500 h-7"
                  onClick={() => setShowPrefs(true)}
                >
                  <Settings className="h-3 w-3 mr-1" />
                  Notification settings
                </Button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};
