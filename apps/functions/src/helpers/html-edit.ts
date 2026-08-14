/**
 * Locate a PLAIN-TEXT `before` string inside raw HTML and replace exactly that
 * span with `after`, preserving the surrounding markup.
 *
 * Why this exists: the package-edit worker copies `before` verbatim from
 * `get_document_section`, which returns `stripHtml(...)` — plain text with tags
 * removed, entities decoded, and whitespace collapsed. The stored HTML, however,
 * still has tags/entities/whitespace. A naive `html.includes(before)` therefore
 * almost never matches, which made every document edit skip as "changed since
 * proposed". This builds a normalized plain-text view of the HTML *with an offset
 * map back to the raw HTML*, finds `before` in that view, and rewrites only the
 * mapped raw-HTML slice — so an inline value change (e.g. inside <strong>…</strong>)
 * keeps its formatting.
 *
 * The normalization here mirrors `stripHtml` (compliance-review-html.ts) plus the
 * `\s+ → ' '` collapse the propose-engine uses to validate `before`, so apply and
 * validation agree on the same representation. The entity table is shared with
 * `decodeHtmlEntities` (via `matchHtmlEntityAt`) so both decode the exact same set
 * — a divergence here would silently drop any edit whose context touches an entity
 * one side doesn't know (e.g. a curly apostrophe or em-dash in generated prose).
 */

import { matchHtmlEntityAt } from '@/helpers/html-text';

const BR_RE = /^<br\s*\/?>/i;

interface PlainMap {
  /** Normalized plain text (tags stripped, entities decoded, whitespace collapsed). */
  text: string;
  /** For plain char i: the raw-HTML start index that produced it. Length = text.length + 1. */
  starts: number[];
  /** For plain char i: the raw-HTML end index (exclusive). Length = text.length. */
  ends: number[];
}

/**
 * Build a normalized plain-text projection of `html` with a per-character map
 * back to raw-HTML offsets.
 */
const buildPlainMap = (html: string): PlainMap => {
  // Pass 1: strip tags, decode entities, <br> → '\n'. Track raw offsets per char.
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];

  let p = 0;
  while (p < html.length) {
    const c = html[p];
    if (c === '<') {
      const close = html.indexOf('>', p);
      const tagEnd = close === -1 ? html.length : close + 1;
      if (BR_RE.test(html.slice(p, tagEnd))) {
        chars.push('\n');
        starts.push(p);
        ends.push(tagEnd);
      }
      p = tagEnd;
      continue;
    }
    if (c === '&') {
      const entity = matchHtmlEntityAt(html, p);
      if (entity) {
        // Every decoded char in HTML_ENTITIES is a single UTF-16 code unit, so
        // one plain char maps to the whole raw entity span.
        chars.push(entity.char);
        starts.push(p);
        ends.push(p + entity.entity.length);
        p += entity.entity.length;
        continue;
      }
    }
    chars.push(c);
    starts.push(p);
    ends.push(p + 1);
    p += 1;
  }

  // Pass 2: collapse whitespace runs (\s+) to a single space, mapping that space
  // to the whole run's raw range.
  const text: string[] = [];
  const nStarts: number[] = [];
  const nEnds: number[] = [];
  let i = 0;
  while (i < chars.length) {
    if (/\s/.test(chars[i])) {
      const runStart = starts[i];
      let j = i;
      while (j < chars.length && /\s/.test(chars[j])) j++;
      text.push(' ');
      nStarts.push(runStart);
      nEnds.push(ends[j - 1]);
      i = j;
      continue;
    }
    text.push(chars[i]);
    nStarts.push(starts[i]);
    nEnds.push(ends[i]);
    i += 1;
  }

  // `starts` needs a trailing sentinel so a match ending at the last char can map.
  nStarts.push(html.length);
  return { text: text.join(''), starts: nStarts, ends: nEnds };
};

/** Normalize a plain-text needle the same way the projected haystack is normalized. */
const normalizeNeedle = (before: string): string => before.replace(/\s+/g, ' ').trim();

/** Count non-overlapping occurrences of `needle` in `haystack` (literal). */
const countOccurrences = (haystack: string, needle: string): number => {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
};

/** Escape a plain-text replacement for safe insertion into HTML. */
const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Rewrite the matched raw-HTML region with `after` WITHOUT unbalancing tags.
 *
 * The plain-text match can begin or end in the middle of a formatting tag pair
 * (e.g. a bold value inside a sentence). Slicing the whole region out and
 * dropping in plain text would take only one half of such a pair — leaving, say,
 * an unclosed <strong> that turns the rest of the document bold.
 *
 * So we keep EVERY tag in the region verbatim, drop the old text, and place the
 * replacement at the first text position. Because no tag is ever added or
 * removed, tag balance is preserved globally. Finally we strip any tag pairs left
 * empty by the substitution (e.g. `<strong></strong>`), so a fully-contained
 * match still yields clean output.
 */
const rebuildRegionPreservingTags = (region: string, after: string): string => {
  const parts: string[] = [];
  let inserted = false;
  let i = 0;
  while (i < region.length) {
    if (region[i] === '<') {
      const close = region.indexOf('>', i);
      const end = close === -1 ? region.length : close + 1;
      parts.push(region.slice(i, end)); // keep the tag verbatim
      i = end;
    } else {
      // A run of text: replace it. The whole `after` goes in at the first run;
      // later runs are dropped (their content is part of the same match).
      const nextTag = region.indexOf('<', i);
      const textEnd = nextTag === -1 ? region.length : nextTag;
      if (!inserted) {
        parts.push(escapeHtml(after));
        inserted = true;
      }
      i = textEnd;
    }
  }
  if (!inserted) parts.push(escapeHtml(after));

  // Collapse tag pairs the substitution emptied (repeat for nesting).
  let out = parts.join('');
  let prev: string;
  do {
    prev = out;
    out = out.replace(/<([a-zA-Z][^\s>/]*)(?:\s[^>]*)?>\s*<\/\1>/g, '');
  } while (out !== prev);
  return out;
};

export type HtmlEditStatus = 'applied' | 'not-found' | 'ambiguous';

export interface HtmlEditResult {
  status: HtmlEditStatus;
  /** The rewritten HTML (only set when status === 'applied'). */
  html?: string;
  /** Number of matches found (for diagnostics; 0 = not-found, >1 = ambiguous). */
  occurrences: number;
}

/**
 * Find the single occurrence of the plain-text `before` inside `html` and replace
 * that span with `after`. Returns 'not-found' (0 matches) or 'ambiguous' (>1) so
 * the caller can skip+report rather than guess — never edits the wrong spot.
 */
export const applyHtmlEdit = (html: string, before: string, after: string): HtmlEditResult => {
  const needle = normalizeNeedle(before);
  if (!needle) return { status: 'not-found', occurrences: 0 };

  const { text, starts, ends } = buildPlainMap(html);
  const occurrences = countOccurrences(text, needle);
  if (occurrences === 0) return { status: 'not-found', occurrences: 0 };
  if (occurrences > 1) return { status: 'ambiguous', occurrences };

  const matchStart = text.indexOf(needle);
  const matchEnd = matchStart + needle.length; // exclusive plain index
  const htmlStart = starts[matchStart];
  const htmlEnd = ends[matchEnd - 1];

  // Rebuild the matched region keeping its tags intact so a match that begins or
  // ends inside a formatting pair (e.g. <strong>) can't leave an unclosed tag
  // that bleeds formatting into the rest of the document.
  const rebuiltRegion = rebuildRegionPreservingTags(html.slice(htmlStart, htmlEnd), after);
  const newHtml = html.slice(0, htmlStart) + rebuiltRegion + html.slice(htmlEnd);
  return { status: 'applied', html: newHtml, occurrences: 1 };
};
