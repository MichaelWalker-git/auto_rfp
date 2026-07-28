import {
  formatCurrency,
  formatDeadline,
  formatDaysWaiting,
  deadlineLabel,
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

describe('DEADLINE_BADGE_CLASSES', () => {
  it('has a class string for every urgency bucket', () => {
    for (const key of ['none', 'safe', 'soon', 'urgent', 'overdue'] as const) {
      expect(typeof DEADLINE_BADGE_CLASSES[key]).toBe('string');
      expect(DEADLINE_BADGE_CLASSES[key].length).toBeGreaterThan(0);
    }
  });
});
