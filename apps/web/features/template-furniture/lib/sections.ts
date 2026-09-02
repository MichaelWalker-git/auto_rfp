/**
 * Derive furniture sections from template body HTML.
 *
 * A "section" is a page-break-delimited run of content — the unit that
 * per-section header/footer toggles address. This mirrors the server-side split
 * in `apps/functions/src/helpers/export-furniture.ts`; both must recognise the
 * same break markers or the section a user toggles in the editor will not be the
 * section suppressed in the export.
 */

/** Matches the TipTap PageBreak node and the legacy page-break class. */
const PAGE_BREAK_RE =
  /<div[^>]*(?:data-page-break|class="[^"]*page-break-node[^"]*")[^>]*>(?:\s*<\/div>)?/gi;

/** Strip tags and collapse whitespace, for a short human-readable label. */
const toPlainText = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

export interface FurnitureSection {
  index: number;
  /** Short label for the toggle list, e.g. the section's first heading. */
  label: string;
}

/**
 * Split body HTML into sections and label each one.
 *
 * Prefers the first heading as the label, since that is what a user recognises
 * ("Cover Letter", "Appendix A"); falls back to leading body text.
 */
export const deriveFurnitureSections = (bodyHtml: string): FurnitureSection[] => {
  const parts = (bodyHtml || '').split(PAGE_BREAK_RE);

  return parts.map((part, index) => {
    const heading = /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i.exec(part)?.[1];
    const source = heading ?? part;
    const text = toPlainText(source);
    const truncated = text.length > 40 ? `${text.slice(0, 40)}…` : text;

    return {
      index,
      label: truncated || `Section ${index + 1}`,
    };
  });
};

export const countFurnitureSections = (bodyHtml: string): number =>
  deriveFurnitureSections(bodyHtml).length;
