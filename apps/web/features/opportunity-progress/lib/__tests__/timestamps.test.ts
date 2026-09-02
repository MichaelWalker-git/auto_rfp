import { newestTimestamp } from '../timestamps';

describe('newestTimestamp', () => {
  it('returns the newest ISO value', () => {
    expect(
      newestTimestamp(['2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z', '2026-02-01T00:00:00Z']),
    ).toBe('2026-03-01T00:00:00Z');
  });

  it('ignores nullish and unparseable values', () => {
    expect(
      newestTimestamp([null, undefined, 'not-a-date', '2026-01-01T00:00:00Z']),
    ).toBe('2026-01-01T00:00:00Z');
  });

  it('returns undefined when nothing is usable', () => {
    expect(newestTimestamp([])).toBeUndefined();
    expect(newestTimestamp([null, 'nope'])).toBeUndefined();
  });
});
