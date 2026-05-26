/**
 * Parse a Bedrock-emitted page range like "13", "17-19", or "20-21,25" into a
 * Set of 1-indexed page numbers. Returns null for empty/malformed input so
 * callers can treat that as "no filter, accept every page".
 *
 * Shared by:
 *   - apps/functions/src/helpers/textract-forms.ts (filter Textract blocks)
 *   - apps/functions/src/helpers/pdf-form-filler.ts (slice exported PDF)
 *   - apps/web/features/required-forms/components/PdfFormEditor.tsx
 *     (skip non-form pages in the viewer)
 */
export const parsePageRange = (range: string | null | undefined): Set<number> | null => {
  if (!range) return null;
  const pages = new Set<number>();
  for (const part of range.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const dash = trimmed.indexOf('-');
    if (dash === -1) {
      const n = Number.parseInt(trimmed, 10);
      if (Number.isFinite(n) && n > 0) pages.add(n);
      continue;
    }
    const start = Number.parseInt(trimmed.slice(0, dash), 10);
    const end = Number.parseInt(trimmed.slice(dash + 1), 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    for (let p = lo; p <= hi; p++) if (p > 0) pages.add(p);
  }
  return pages.size > 0 ? pages : null;
};
