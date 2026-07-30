import {
  formatCurrency,
  formatDeadline,
  formatDaysWaiting,
  deadlineLabel,
  formatRelativeTime,
  DEADLINE_BADGE_CLASSES,
} from '../format';

describe('formatCurrency', () => {
  it('renders a dollar amount with thousands separators', () => {
    expect(formatCurrency(100_000)).toBe('$100,000');
  });
  it('renders an em dash for null/undefined', () => {
    expect(formatCurrency(null)).toBe('—');
    expect(formatCurrency(undefined)).toBe('—');
  });
  it('renders zero as $0 (not a dash)', () => {
    expect(formatCurrency(0)).toBe('$0');
  });
});

describe('formatDeadline', () => {
  it('says "No deadline" for a missing or unparseable value', () => {
    expect(formatDeadline(null)).toBe('No deadline');
    expect(formatDeadline('not-a-date')).toBe('No deadline');
  });
  it('formats a valid ISO date', () => {
    expect(formatDeadline('2026-07-27T00:00:00.000Z')).not.toBe('No deadline');
  });
});

describe('formatDaysWaiting', () => {
  it('handles null, today, singular, and plural', () => {
    expect(formatDaysWaiting(null)).toBe('Unknown');
    expect(formatDaysWaiting(0)).toBe('Today');
    expect(formatDaysWaiting(1)).toBe('1 day');
    expect(formatDaysWaiting(5)).toBe('5 days');
  });
});

describe('deadlineLabel', () => {
  it('says "No deadline" when there is none', () => {
    expect(deadlineLabel('none', null)).toBe('No deadline');
  });
  it('shows overdue days as absolute', () => {
    expect(deadlineLabel('overdue', -7)).toBe('Overdue 7d');
  });
  it('says "Due today" at zero days', () => {
    expect(deadlineLabel('urgent', 0)).toBe('Due today');
  });
  it('shows days left otherwise', () => {
    expect(deadlineLabel('soon', 5)).toBe('5d left');
  });
});

describe('formatRelativeTime', () => {
  const NOW = '2026-07-27T12:00:00.000Z';

  it('returns an empty string for missing or unparseable input', () => {
    expect(formatRelativeTime(null, NOW)).toBe('');
    expect(formatRelativeTime(undefined, NOW)).toBe('');
    expect(formatRelativeTime('not-a-date', NOW)).toBe('');
    expect(formatRelativeTime('2026-07-27T12:00:00.000Z', 'not-a-date')).toBe('');
  });

  it('says "just now" for anything under a minute (including future/now)', () => {
    expect(formatRelativeTime('2026-07-27T11:59:30.000Z', NOW)).toBe('just now');
    expect(formatRelativeTime(NOW, NOW)).toBe('just now');
    // Future timestamps clamp to "just now" rather than showing negatives.
    expect(formatRelativeTime('2026-07-27T12:05:00.000Z', NOW)).toBe('just now');
  });

  it('formats minutes ago', () => {
    expect(formatRelativeTime('2026-07-27T11:57:00.000Z', NOW)).toBe('3 min ago');
    expect(formatRelativeTime('2026-07-27T11:01:00.000Z', NOW)).toBe('59 min ago');
  });

  it('formats hours ago', () => {
    expect(formatRelativeTime('2026-07-27T11:00:00.000Z', NOW)).toBe('1 hr ago');
    expect(formatRelativeTime('2026-07-27T02:00:00.000Z', NOW)).toBe('10 hr ago');
  });

  it('formats days ago with singular/plural', () => {
    expect(formatRelativeTime('2026-07-26T12:00:00.000Z', NOW)).toBe('1 day ago');
    expect(formatRelativeTime('2026-07-24T12:00:00.000Z', NOW)).toBe('3 days ago');
  });
});

describe('DEADLINE_BADGE_CLASSES', () => {
  it('has a class string for every urgency bucket', () => {
    for (const key of ['none', 'safe', 'soon', 'urgent', 'overdue'] as const) {
      expect(typeof DEADLINE_BADGE_CLASSES[key]).toBe('string');
      expect(DEADLINE_BADGE_CLASSES[key].length).toBeGreaterThan(0);
    }
  });
});
