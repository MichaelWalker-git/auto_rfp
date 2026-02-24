'use client';

import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { useNotificationPreferences } from '../hooks/useNotificationPreferences';
import type { NotificationType } from '@auto-rfp/core';

interface NotificationPreferencesFormProps {
  orgId: string;
}

// ─── Channel section ──────────────────────────────────────────────────────────

const CHANNELS = [
  { key: 'inApp' as const, label: 'In-app notifications', description: 'Show notifications in the bell icon' },
  { key: 'email' as const, label: 'Email notifications', description: 'Send notifications to your email (opt-in)' },
  { key: 'slack' as const, label: 'Slack notifications', description: 'Send notifications to Slack (opt-in)' },
];

// ─── Per-type section ─────────────────────────────────────────────────────────

const NOTIFICATION_TYPE_GROUPS: Array<{
  group: string;
  types: Array<{ type: NotificationType; label: string }>;
}> = [
  {
    group: 'RFP Lifecycle',
    types: [
      { type: 'RFP_UPLOADED', label: 'RFP document uploaded' },
      { type: 'QUESTIONS_EXTRACTED', label: 'Questions extracted' },
      { type: 'ANSWERS_GENERATED', label: 'Answers generated' },
      { type: 'PROPOSAL_SUBMITTED', label: 'Proposal submitted' },
      { type: 'WIN_RECORDED', label: 'Win recorded' },
      { type: 'LOSS_RECORDED', label: 'Loss recorded' },
    ],
  },
  {
    group: 'Collaboration',
    types: [
      { type: 'MENTION', label: 'Mentioned in a comment' },
      { type: 'ASSIGNMENT', label: 'Question assigned to me' },
      { type: 'REVIEW_ASSIGNED', label: 'Review assigned to me' },
    ],
  },
  {
    group: 'Deadline Alerts',
    types: [
      { type: 'DEADLINE_7_DAYS', label: '7 days before deadline' },
      { type: 'DEADLINE_3_DAYS', label: '3 days before deadline' },
      { type: 'DEADLINE_1_DAY', label: '1 day before deadline' },
      { type: 'DEADLINE_6_HOURS', label: '6 hours before deadline' },
    ],
  },
  {
    group: 'System',
    types: [
      { type: 'PROCESSING_COMPLETE', label: 'Processing complete' },
      { type: 'PROCESSING_ERROR', label: 'Processing error' },
      { type: 'EXPORT_READY', label: 'Export ready' },
    ],
  },
];

// ─── Component ────────────────────────────────────────────────────────────────

export const NotificationPreferencesForm = ({ orgId }: NotificationPreferencesFormProps) => {
  const { preferences, isLoading, update } = useNotificationPreferences(orgId);

  if (isLoading) {
    return (
      <div className="space-y-4 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between">
            <div className="space-y-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-6 w-10 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  const handleChannelToggle = (field: 'email' | 'inApp' | 'slack' | 'sms') => (checked: boolean) => {
    update.trigger({ orgId, [field]: checked });
  };

  const handleTypeToggle = (type: NotificationType) => (checked: boolean) => {
    const current = preferences?.typeOverrides ?? {};
    update.trigger({ orgId, typeOverrides: { ...current, [type]: checked } });
  };

  const isTypeEnabled = (type: NotificationType): boolean => {
    if (preferences?.typeOverrides && type in preferences.typeOverrides) {
      return preferences.typeOverrides[type] ?? true;
    }
    return true; // default: all types enabled
  };

  return (
    <div className="space-y-6">
      {/* ── Channels ── */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">Notification Channels</h3>
        <div className="space-y-3">
          {CHANNELS.map(({ key, label, description }) => (
            <div key={key} className="flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <Label htmlFor={`channel-${key}`} className="text-sm font-medium cursor-pointer">
                  {label}
                </Label>
                <p className="text-xs text-slate-500 mt-0.5">{description}</p>
              </div>
              <Switch
                id={`channel-${key}`}
                checked={preferences?.[key] ?? (key === 'inApp')}
                onCheckedChange={handleChannelToggle(key)}
                disabled={update.isMutating}
              />
            </div>
          ))}
        </div>
      </div>

      <Separator />

      {/* ── Per-type overrides ── */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-1">Notification Types</h3>
        <p className="text-xs text-slate-500 mb-3">
          Choose which events you want to be notified about.
        </p>
        <div className="space-y-5">
          {NOTIFICATION_TYPE_GROUPS.map(({ group, types }) => (
            <div key={group}>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">{group}</p>
              <div className="space-y-2">
                {types.map(({ type, label }) => (
                  <div key={type} className="flex items-center justify-between">
                    <Label htmlFor={`type-${type}`} className="text-sm cursor-pointer">
                      {label}
                    </Label>
                    <Switch
                      id={`type-${type}`}
                      checked={isTypeEnabled(type)}
                      onCheckedChange={handleTypeToggle(type)}
                      disabled={update.isMutating}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
