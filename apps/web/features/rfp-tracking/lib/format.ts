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
