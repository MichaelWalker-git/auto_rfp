/**
 * Minimal HTML section utilities for compliance review.
 *
 * RFP documents are stored as HTML. We don't ship an HTML parser dependency, so
 * headings and section text are extracted with regex — the same `<h1/h2/h3>`
 * text the frontend matches against for scroll-to-highlight, so anchors round-trip.
 */

const HEADING_RE = /<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi;
const TAG_RE = /<[^>]+>/g;

/** Strip tags and decode a few common entities to plain text. */
export const stripHtml = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(TAG_RE, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Ordered list of heading texts (trimmed, tags stripped) as they appear. */
export const extractHeadings = (html: string): string[] => {
  const headings: string[] = [];
  let m: RegExpExecArray | null;
  HEADING_RE.lastIndex = 0;
  while ((m = HEADING_RE.exec(html)) !== null) {
    const text = stripHtml(m[2]);
    if (text) headings.push(text);
  }
  return headings;
};

/**
 * Return the plain-text content under the heading whose text matches `heading`
 * (up to the next heading of the same-or-higher level), truncated to maxChars.
 * Falls back to whole-document text if no heading matches.
 */
export const getSectionText = (html: string, heading: string, maxChars: number): string => {
  const target = heading.trim().toLowerCase();
  // Capture each heading's LEVEL (1/2/3) so a parent section includes its
  // subsections. "3. Labor Rate Schedule" (h2) must swallow "3.1 …" (h3) — the
  // section ends only at the next heading of the SAME OR HIGHER level (i.e.
  // level <= this one), not merely the immediate next heading.
  const matches: Array<{ index: number; end: number; level: number; text: string }> = [];
  let m: RegExpExecArray | null;
  HEADING_RE.lastIndex = 0;
  while ((m = HEADING_RE.exec(html)) !== null) {
    matches.push({
      index: m.index,
      end: HEADING_RE.lastIndex,
      level: Number(m[1][1]), // 'h2' -> 2
      text: stripHtml(m[2]).toLowerCase(),
    });
  }

  const startIdx = matches.findIndex((h) => h.text === target);
  if (startIdx === -1) {
    return stripHtml(html).slice(0, maxChars);
  }
  const startLevel = matches[startIdx].level;
  const start = matches[startIdx].end;

  // Next heading at the same or higher level ends the section; deeper (child)
  // headings are kept inside it.
  const boundary = matches.slice(startIdx + 1).find((h) => h.level <= startLevel);
  const end = boundary ? boundary.index : html.length;

  // Include the child headings' own text in the returned content (they were
  // sliced out as tags by stripHtml, but their heading text is meaningful), so
  // keep the raw slice — stripHtml already preserves heading text as plain text.
  return stripHtml(html.slice(start, end)).slice(0, maxChars);
};
