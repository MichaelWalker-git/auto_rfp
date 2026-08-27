/**
 * Minimal HTML section utilities for compliance review.
 *
 * RFP documents are stored as HTML. We don't ship an HTML parser dependency, so
 * headings and section text are extracted with regex — the same `<h1/h2/h3>`
 * text the frontend matches against for scroll-to-highlight, so anchors round-trip.
 */

import { decodeHtmlEntities } from './html-text';

const HEADING_RE = /<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi;
const TAG_RE = /<[^>]+>/g;

/** Strip tags and decode entities to plain text, preserving `<br>` line breaks. */
export const stripHtml = (html: string): string =>
  decodeHtmlEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(TAG_RE, ''))
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

/** One non-overlapping slice of a document, anchored to its nearest heading. */
export interface DocumentSection {
  /** Heading text this segment falls under, or '' for text before the first heading. */
  heading: string;
  /** Plain text of THIS segment only (not including child subsections). */
  text: string;
}

/**
 * Split a document into NON-OVERLAPPING sections — one segment per heading,
 * covering the text from that heading up to the NEXT heading of ANY level, so
 * every character of the document belongs to exactly one segment (its nearest
 * preceding heading).
 *
 * This is deliberately different from `getSectionText`, which lets a parent
 * heading's section SWALLOW its child subsections (correct for "read this whole
 * section" but wrong for scanning: a single occurrence would then appear in the
 * parent segment AND every enclosing child, producing duplicate findings for one
 * spot). Scanners (NDA-leak, KB-contradiction) must use THIS to attribute each
 * occurrence to a single anchor.
 *
 * Text before the first heading (or a document with no headings) yields one
 * segment with `heading: ''`.
 */
export const splitIntoSections = (html: string): DocumentSection[] => {
  const matches: Array<{ index: number; end: number; text: string }> = [];
  let m: RegExpExecArray | null;
  HEADING_RE.lastIndex = 0;
  while ((m = HEADING_RE.exec(html)) !== null) {
    matches.push({ index: m.index, end: HEADING_RE.lastIndex, text: stripHtml(m[2]) });
  }

  const sections: DocumentSection[] = [];

  // Preamble: any text before the first heading (or the whole doc if none).
  const firstStart = matches.length > 0 ? matches[0].index : html.length;
  const preamble = stripHtml(html.slice(0, firstStart));
  if (preamble) sections.push({ heading: '', text: preamble });

  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].end;
    const end = i + 1 < matches.length ? matches[i + 1].index : html.length;
    const text = stripHtml(html.slice(start, end));
    // Keep even empty-body headings out (nothing to scan there).
    if (text) sections.push({ heading: matches[i].text, text });
  }

  return sections;
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
