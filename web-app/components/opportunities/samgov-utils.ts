export function mmddyyyy(d: Date) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${mm}/${dd}/${yyyy}`;
}

export function defaultDateRange(daysBack = 14) {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - daysBack);
  return { postedFrom: mmddyyyy(from), postedTo: mmddyyyy(to) };
}

export function fmtDate(s?: string) {
  if (!s) return '';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function safeUrl(desc?: string): string | null {
  if (!desc) return null;
  try {
    return new URL(desc).toString();
  } catch {
    return null;
  }
}

export const QUICK_FILTERS = [
  { label: '7d', days: 7 },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
];
