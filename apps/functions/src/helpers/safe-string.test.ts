/**
 * Tests for safe string utilities.
 * These utilities prevent runtime errors like AUTO-RFP-3V.
 */

import {
  safeString,
  safeTrim,
  safeLowerCase,
  safeUpperCase,
  safeSplit,
  safeSplitAt,
  parseSortKey,
  safeParseJson,
  safeParseJsonOr,
  isNonEmptyString,
  isString,
} from './safe-string';

describe('safeString', () => {
  it('returns empty string for null', () => {
    expect(safeString(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(safeString(undefined)).toBe('');
  });

  it('returns string unchanged', () => {
    expect(safeString('hello')).toBe('hello');
    expect(safeString('')).toBe('');
  });

  it('converts numbers to string', () => {
    expect(safeString(123)).toBe('123');
    expect(safeString(0)).toBe('0');
  });

  it('converts arrays to string', () => {
    expect(safeString(['a', 'b'])).toBe('a,b');
  });

  it('converts objects to string', () => {
    expect(safeString({ foo: 'bar' })).toBe('[object Object]');
  });
});

describe('safeTrim', () => {
  it('trims strings', () => {
    expect(safeTrim('  hello  ')).toBe('hello');
  });

  it('handles null/undefined without throwing', () => {
    expect(safeTrim(null)).toBe('');
    expect(safeTrim(undefined)).toBe('');
  });

  it('handles arrays without throwing (regression: AUTO-RFP-3V)', () => {
    // This was the actual bug - text was sometimes an array
    expect(safeTrim(['a', 'b'])).toBe('a,b');
  });

  it('handles objects without throwing', () => {
    expect(safeTrim({ text: 'hello' })).toBe('[object Object]');
  });

  it('handles numbers', () => {
    expect(safeTrim(123)).toBe('123');
  });
});

describe('safeLowerCase', () => {
  it('converts to lowercase', () => {
    expect(safeLowerCase('HELLO')).toBe('hello');
  });

  it('handles non-strings', () => {
    expect(safeLowerCase(null)).toBe('');
    expect(safeLowerCase(undefined)).toBe('');
  });
});

describe('safeUpperCase', () => {
  it('converts to uppercase', () => {
    expect(safeUpperCase('hello')).toBe('HELLO');
  });

  it('handles non-strings', () => {
    expect(safeUpperCase(null)).toBe('');
  });
});

describe('safeSplit', () => {
  it('splits strings', () => {
    expect(safeSplit('a,b,c', ',')).toEqual(['a', 'b', 'c']);
  });

  it('handles empty string', () => {
    expect(safeSplit('', ',')).toEqual(['']);
  });

  it('handles no separator found', () => {
    expect(safeSplit('abc', ',')).toEqual(['abc']);
  });

  it('handles null/undefined', () => {
    expect(safeSplit(null, ',')).toEqual(['']);
    expect(safeSplit(undefined, ',')).toEqual(['']);
  });

  it('handles regex separator', () => {
    expect(safeSplit('a1b2c', /\d/)).toEqual(['a', 'b', 'c']);
  });
});

describe('safeSplitAt', () => {
  it('gets element at index', () => {
    expect(safeSplitAt('ORG#123#USER#456', '#', 0)).toBe('ORG');
    expect(safeSplitAt('ORG#123#USER#456', '#', 1)).toBe('123');
    expect(safeSplitAt('ORG#123#USER#456', '#', 3)).toBe('456');
  });

  it('returns empty string for out-of-bounds index', () => {
    expect(safeSplitAt('ORG#123', '#', 5)).toBe('');
    expect(safeSplitAt('ORG#123', '#', -1)).toBe('');
  });

  it('handles null/undefined input', () => {
    expect(safeSplitAt(null, '#', 0)).toBe('');
    expect(safeSplitAt(undefined, '#', 1)).toBe('');
  });

  it('handles missing separator', () => {
    expect(safeSplitAt('no-hash-here', '#', 0)).toBe('no-hash-here');
    expect(safeSplitAt('no-hash-here', '#', 1)).toBe('');
  });
});

describe('parseSortKey', () => {
  it('parses standard sort key format', () => {
    const result = parseSortKey('ORG#org123#USER#user456', ['orgId', 'userId']);
    expect(result).toEqual({ orgId: 'org123', userId: 'user456' });
  });

  it('handles missing parts', () => {
    const result = parseSortKey('ORG#org123', ['orgId', 'userId']);
    expect(result).toEqual({ orgId: 'org123', userId: '' });
  });

  it('handles empty/null input', () => {
    const result = parseSortKey(null, ['orgId', 'userId']);
    expect(result).toEqual({ orgId: '', userId: '' });
  });

  it('handles single key', () => {
    const result = parseSortKey('PREFIX#value', ['id']);
    expect(result).toEqual({ id: 'value' });
  });

  it('handles knowledge base document key', () => {
    const result = parseSortKey('KB#kb-123#DOC#doc-456', ['kbId', 'docId']);
    expect(result).toEqual({ kbId: 'kb-123', docId: 'doc-456' });
  });
});

describe('safeParseJson', () => {
  it('parses valid JSON', () => {
    expect(safeParseJson('{"foo":"bar"}')).toEqual({ foo: 'bar' });
    expect(safeParseJson('[1,2,3]')).toEqual([1, 2, 3]);
    expect(safeParseJson('"hello"')).toBe('hello');
  });

  it('returns null for invalid JSON', () => {
    expect(safeParseJson('not json')).toBeNull();
    expect(safeParseJson('{invalid}')).toBeNull();
    expect(safeParseJson('{"truncated":')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(safeParseJson('')).toBeNull();
    expect(safeParseJson(null)).toBeNull();
    expect(safeParseJson(undefined)).toBeNull();
  });

  it('handles non-string input', () => {
    // Numbers get stringified then parsed
    expect(safeParseJson(123)).toBe(123);
  });
});

describe('safeParseJsonOr', () => {
  it('returns parsed value on success', () => {
    expect(safeParseJsonOr('{"foo":"bar"}', {})).toEqual({ foo: 'bar' });
  });

  it('returns fallback on failure', () => {
    expect(safeParseJsonOr('invalid', { default: true })).toEqual({ default: true });
    expect(safeParseJsonOr(null, [])).toEqual([]);
  });
});

describe('isNonEmptyString', () => {
  it('returns true for non-empty strings', () => {
    expect(isNonEmptyString('hello')).toBe(true);
    expect(isNonEmptyString('  hello  ')).toBe(true);
  });

  it('returns false for empty/whitespace strings', () => {
    expect(isNonEmptyString('')).toBe(false);
    expect(isNonEmptyString('   ')).toBe(false);
  });

  it('returns false for non-strings', () => {
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString(123)).toBe(false);
    expect(isNonEmptyString(['a'])).toBe(false);
  });
});

describe('isString', () => {
  it('returns true for strings', () => {
    expect(isString('hello')).toBe(true);
    expect(isString('')).toBe(true);
  });

  it('returns false for non-strings', () => {
    expect(isString(null)).toBe(false);
    expect(isString(undefined)).toBe(false);
    expect(isString(123)).toBe(false);
  });
});
