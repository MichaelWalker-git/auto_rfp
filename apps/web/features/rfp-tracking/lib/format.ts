import type { DeadlineUrgency } from './derive-board';

export const formatCurrency = (value: number | null | undefined): string => {
  if (value == null) return '—';
  return `$${value.toLocaleString()}`;
};

export const formatDeadline = (iso: string | null | undefined): string => {
  if (!iso) return 'No deadline';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return 'No deadline';
  return new Date(ts).toLocaleDateString();
};

export const formatDaysWaiting = (days: number | null): string => {
  if (days === null) return 'Unknown';
  if (days === 0) return 'Today';
  if (days === 1) return '1 day';
  return `${days} days`;
};

/** Tailwind classes for the deadline badge, keyed by urgency. */
export const DEADLINE_BADGE_CLASSES: Record<DeadlineUrgency, string> = {
  none: 'bg-slate-100 text-slate-500 border-slate-200',
  safe: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  soon: 'bg-amber-100 text-amber-700 border-amber-200',
  urgent: 'bg-red-100 text-red-700 border-red-200',
  overdue: 'bg-red-200 text-red-800 border-red-300',
};

export const deadlineLabel = (urgency: DeadlineUrgency, daysToDeadline: number | null): string => {
  if (urgency === 'none' || daysToDeadline === null) return 'No deadline';
  if (urgency === 'overdue') return `Overdue ${Math.abs(daysToDeadline)}d`;
  if (daysToDeadline === 0) return 'Due today';
  return `${daysToDeadline}d left`;
};

/**
 * A short, human-friendly "time ago" string relative to `nowIso` (injectable so
 * it stays testable). Clamps future/negative deltas to "just now". Returns '' for
 * missing or unparseable input so callers can render nothing.
 */
export const formatRelativeTime = (iso: string | null | undefined, nowIso: string): string => {
  if (!iso) return '';
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (Number.isNaN(then) || Number.isNaN(now)) return '';

  const diffSeconds = Math.floor((now - then) / 1000);
  if (diffSeconds < 60) return 'just now';

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} min ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hr ago`;

  const diffDays = Math.floor(diffHours / 24);
  return diffDays === 1 ? '1 day ago' : `${diffDays} days ago`;
};
