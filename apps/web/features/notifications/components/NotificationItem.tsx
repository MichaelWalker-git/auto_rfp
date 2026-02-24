'use client';

import { useRouter } from 'next/navigation';
import { formatDistanceToNow } from 'date-fns';
import { X, Bell, AtSign, UserCheck, FileText, CheckCircle, Trophy, XCircle, Clock, AlertCircle, FileCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { NotificationItem as NotificationItemType, NotificationType } from '@auto-rfp/core';

interface NotificationItemProps {
  notification: NotificationItemType;
  orgId: string;
  onArchive: () => void;
  onRead: (notificationId: string) => void;
  /** Called to close the popover before navigating */
  onClose?: () => void;
}

// ─── Type icon + colour mapping ───────────────────────────────────────────────

const TYPE_CONFIG: Record<NotificationType, { icon: React.ElementType; color: string; bg: string }> = {
  MENTION:              { icon: AtSign,       color: 'text-indigo-600', bg: 'bg-indigo-100' },
  ASSIGNMENT:           { icon: UserCheck,    color: 'text-blue-600',   bg: 'bg-blue-100' },
  REVIEW_ASSIGNED:      { icon: UserCheck,    color: 'text-blue-600',   bg: 'bg-blue-100' },
  RFP_UPLOADED:         { icon: FileText,     color: 'text-slate-600',  bg: 'bg-slate-100' },
  QUESTIONS_EXTRACTED:  { icon: FileCheck,    color: 'text-violet-600', bg: 'bg-violet-100' },
  ANSWERS_GENERATED:    { icon: CheckCircle,  color: 'text-emerald-600',bg: 'bg-emerald-100' },
  PROPOSAL_SUBMITTED:   { icon: FileText,     color: 'text-blue-600',   bg: 'bg-blue-100' },
  WIN_RECORDED:         { icon: Trophy,       color: 'text-amber-600',  bg: 'bg-amber-100' },
  LOSS_RECORDED:        { icon: XCircle,      color: 'text-red-500',    bg: 'bg-red-100' },
  DEADLINE_7_DAYS:      { icon: Clock,        color: 'text-orange-500', bg: 'bg-orange-100' },
  DEADLINE_3_DAYS:      { icon: Clock,        color: 'text-orange-600', bg: 'bg-orange-100' },
  DEADLINE_1_DAY:       { icon: AlertCircle,  color: 'text-red-500',    bg: 'bg-red-100' },
  DEADLINE_6_HOURS:     { icon: AlertCircle,  color: 'text-red-600',    bg: 'bg-red-100' },
  PROCESSING_COMPLETE:  { icon: CheckCircle,  color: 'text-emerald-600',bg: 'bg-emerald-100' },
  PROCESSING_ERROR:     { icon: AlertCircle,  color: 'text-red-500',    bg: 'bg-red-100' },
  EXPORT_READY:         { icon: FileText,     color: 'text-blue-600',   bg: 'bg-blue-100' },
};

const DEFAULT_CONFIG = { icon: Bell, color: 'text-slate-500', bg: 'bg-slate-100' };

// ─── Link builder ─────────────────────────────────────────────────────────────

const buildNotificationLink = (
  type: NotificationType,
  orgId: string,
  projectId?: string,
  entityId?: string,
): string | null => {
  if (!projectId) return null;
  const base = `/organizations/${orgId}/projects/${projectId}`;

  switch (type) {
    case 'MENTION':
    case 'ASSIGNMENT':
    case 'REVIEW_ASSIGNED':
      return entityId ? `${base}/questions?questionId=${entityId}` : `${base}/questions`;
    case 'QUESTIONS_EXTRACTED':
    case 'ANSWERS_GENERATED':
      return `${base}/questions`;
    case 'WIN_RECORDED':
    case 'LOSS_RECORDED':
    case 'PROPOSAL_SUBMITTED':
      return `${base}/outcomes`;
    case 'RFP_UPLOADED':
      return `${base}/documents`;
    case 'DEADLINE_7_DAYS':
    case 'DEADLINE_3_DAYS':
    case 'DEADLINE_1_DAY':
    case 'DEADLINE_6_HOURS':
    case 'PROCESSING_COMPLETE':
    case 'PROCESSING_ERROR':
    case 'EXPORT_READY':
    default:
      return `${base}/dashboard`;
  }
};

// ─── Component ────────────────────────────────────────────────────────────────

export const NotificationItem = ({ notification, orgId, onArchive, onRead, onClose }: NotificationItemProps) => {
  const router = useRouter();
  const { title, message, read, createdAt, type, projectId, entityId, notificationId } = notification;
  const config = TYPE_CONFIG[type] ?? DEFAULT_CONFIG;
  const Icon = config.icon;

  const link = buildNotificationLink(type, orgId, projectId, entityId);

  const handleClick = () => {
    // 1. Mark as read (optimistic — instant UI update, API fires in background)
    if (!read) {
      onRead(notificationId);
    }

    if (link) {
      // 2. Close the popover so it doesn't stay open after navigation
      onClose?.();
      // 3. Navigate with Next.js router (soft navigation, no full reload)
      router.push(link);
    }
  };

  return (
    <div
      className={cn(
        'flex gap-3 px-4 py-3 hover:bg-slate-50 transition-colors group',
        !read && 'bg-indigo-50/40',
        link ? 'cursor-pointer' : 'cursor-default',
      )}
      onClick={handleClick}
      role={link ? 'button' : undefined}
    >
      {/* Type icon */}
      <div className={cn('flex-shrink-0 h-8 w-8 rounded-full flex items-center justify-center mt-0.5', config.bg)}>
        <Icon className={cn('h-4 w-4', config.color)} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className={cn('text-sm leading-snug', !read ? 'font-semibold text-slate-900' : 'text-slate-700')}>
            {title}
          </p>
          {!read && (
            <span className="flex-shrink-0 mt-1.5 h-2 w-2 rounded-full bg-indigo-500" />
          )}
        </div>
        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{message}</p>
        <p className="text-xs text-slate-400 mt-1">
          {formatDistanceToNow(new Date(createdAt), { addSuffix: true })}
        </p>
      </div>

      {/* Archive button — visible on hover */}
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 flex-shrink-0 text-slate-300 hover:text-slate-600 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5"
        onClick={(e) => { e.stopPropagation(); onArchive(); }}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
};
