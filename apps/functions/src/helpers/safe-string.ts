/**
 * Safe string utilities to prevent runtime errors from calling string methods
 * on non-string values. These utilities address patterns that caused Sentry issues
 * like AUTO-RFP-3V (text.trim() on non-string).
 */

/**
 * Safely converts any value to a string.
 * - null/undefined -> ''
 * - strings -> unchanged
 * - other types -> String(val)
 */
export function safeString(val: unknown): string {
  if (val === null || val === undefined) return '';
  if (typeof val === 'string') return val;
  return String(val);
}

/**
 * Safely trims a value, handling non-strings.
 * Prevents: TypeError: (text ?? "").trim is not a function
 */
export function safeTrim(val: unknown): string {
  return safeString(val).trim();
}

/**
 * Safely converts to lowercase, handling non-strings.
 */
export function safeLowerCase(val: unknown): string {
  return safeString(val).toLowerCase();
}

/**
 * Safely converts to uppercase, handling non-strings.
 */
export function safeUpperCase(val: unknown): string {
  return safeString(val).toUpperCase();
}

/**
 * Safely splits a value by separator, handling non-strings.
 * Always returns an array (never throws).
 */
export function safeSplit(val: unknown, separator: string | RegExp): string[] {
  return safeString(val).split(separator);
}

/**
 * Safely gets an element from a split operation with bounds checking.
 * Returns empty string if index is out of bounds.
 *
 * @example
 * safeSplitAt('ORG#123#USER#456', '#', 1) // '123'
 * safeSplitAt('no-hash', '#', 1) // ''
 */
export function safeSplitAt(val: unknown, separator: string | RegExp, index: number): string {
  const parts = safeSplit(val, separator);
  return parts[index] ?? '';
}

/**
 * Parses a DynamoDB sort key with the pattern: PREFIX#id#PREFIX#id...
 * Returns an object with the parsed values, with empty strings for missing parts.
 *
 * @example
 * parseSortKey('ORG#org123#USER#user456', ['orgId', 'userId'])
 * // { orgId: 'org123', userId: 'user456' }
 *
 * parseSortKey('ORG#org123', ['orgId', 'userId'])
 * // { orgId: 'org123', userId: '' }
 */
export function parseSortKey<T extends string>(
  sk: unknown,
  keys: T[],
): Record<T, string> {
  const parts = safeSplit(sk, '#');
  const result = {} as Record<T, string>;

  for (let i = 0; i < keys.length; i++) {
    // Each key corresponds to an odd index (1, 3, 5, ...)
    // because format is PREFIX#value#PREFIX#value
    const key = keys[i]!; // Safe: iterating within bounds
    const valueIndex = i * 2 + 1;
    result[key] = parts[valueIndex] ?? '';
  }

  return result;
}

/**
 * Safely parses JSON with error handling.
 * Returns null on parse failure instead of throwing.
 */
export function safeParseJson<T = unknown>(val: unknown): T | null {
  const str = safeString(val);
  if (!str) return null;

  try {
    return JSON.parse(str) as T;
  } catch {
    return null;
  }
}

/**
 * Safely parses JSON with a fallback value.
 */
export function safeParseJsonOr<T>(val: unknown, fallback: T): T {
  const result = safeParseJson<T>(val);
  return result ?? fallback;
}

/**
 * Type guard to check if a value is a non-empty string.
 */
export function isNonEmptyString(val: unknown): val is string {
  return typeof val === 'string' && val.trim().length > 0;
}

/**
 * Type guard to check if a value is a string (including empty).
 */
export function isString(val: unknown): val is string {
  return typeof val === 'string';
}
