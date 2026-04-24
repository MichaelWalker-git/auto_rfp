export const nowIso = () => {
  return new Date().toISOString();
};

/**
 * Normalize a date-like string to full ISO 8601 datetime (UTC).
 * Handles: date-only ("2026-04-10"), datetime with offset ("2026-05-08T16:30:00-05:00"),
 * and standard ISO ("2026-04-10T00:00:00.000Z").
 * Returns null for null/undefined/empty/unparseable values.
 */
export const toIsoDatetime = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const d = new Date(value);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
};