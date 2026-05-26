import { describe, expect, it } from 'vitest';

import { parsePageRange } from './page-range';

describe('parsePageRange', () => {
  it('returns null for null/undefined/empty inputs', () => {
    expect(parsePageRange(null)).toBeNull();
    expect(parsePageRange(undefined)).toBeNull();
    expect(parsePageRange('')).toBeNull();
  });

  it('parses a single page number', () => {
    expect(parsePageRange('13')).toEqual(new Set([13]));
  });

  it('expands a hyphenated range inclusively', () => {
    expect(parsePageRange('17-19')).toEqual(new Set([17, 18, 19]));
  });

  it('expands a comma-separated mix of singles and ranges', () => {
    expect(parsePageRange('1, 3-4, 7')).toEqual(new Set([1, 3, 4, 7]));
  });

  it('tolerates a swapped range (high-low) by treating it as low-high', () => {
    expect(parsePageRange('19-17')).toEqual(new Set([17, 18, 19]));
  });

  it('returns null when nothing parsable was found', () => {
    expect(parsePageRange('not-a-page')).toBeNull();
    expect(parsePageRange('-')).toBeNull();
  });

  it('drops zero/negative numbers', () => {
    expect(parsePageRange('0, -2, 4')).toEqual(new Set([4]));
  });
});
