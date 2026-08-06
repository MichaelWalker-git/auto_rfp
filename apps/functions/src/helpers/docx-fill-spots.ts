import type { DocxAnchor, FieldMarkType } from '@auto-rfp/core';

/**
 * A fillable spot found in a DOCX's document.xml, in document order. This is the
 * SINGLE source of truth shared by detection (docx-structure) and the filler
 * (docx-form-filler): both run findDocxFillSpots over the same XML, so a spot's
 * (kind, ref, occurrence) always resolves to the exact same XML location on both
 * sides — no occurrence drift between "what we showed" and "where we write".
 *
 * `spliceStart`/`spliceEnd` is the XML span to replace with `render(value)`
 * (a zero-width span, start === end, means pure insertion). The filler collects
 * splices for the fields the user filled and applies them in descending-offset
 * order so earlier offsets stay valid.
 */
export type FillSpotKind = Extract<
  DocxAnchor['kind'],
  'TEXT_TOKEN' | 'TEXT_LABEL' | 'TABLE_CELL_LABEL' | 'UNDERSCORE_BLANK' | 'CHECKBOX'
>;

export type FillSpot = {
  kind: FillSpotKind;
  ref: string;
  occurrence: number;
  label: string;
  markType: FieldMarkType;
  spliceStart: number;
  spliceEnd: number;
  render: (value: string) => string;
};

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Sentinel markers for the read-only editor preview. We inject an invisible
// text run carrying the spot's index at each fill location, THEN run mammoth —
// so the marker survives into the HTML at the correct visual position (inside
// the right table cell, on the right line). The frontend swaps each marker for an
// interactive field span. Private-use-area brackets so they never collide with
// real document text. Keep MARK_OPEN/CLOSE in sync with the web decorator.
export const FIELD_MARKER_OPEN = '';
export const FIELD_MARKER_CLOSE = '';
const MARK_OPEN = FIELD_MARKER_OPEN;
const MARK_CLOSE = FIELD_MARKER_CLOSE;
// Matches U+E000 {index} U+E001, capturing the index.
export const FIELD_MARKER_REGEX = /(\d+)/g;

export type FillSpotMeta = { kind: FillSpotKind; ref: string; occurrence: number; label: string };

// Is `offset` inside a <w:t>…</w:t> text body? Distinguishes the text element
// from other <w:t*>-prefixed tags (<w:tab>, <w:tbl>, <w:tc>, <w:tr>, <w:tcPr>):
// only "<w:t>" and "<w:t " (attr) open a text run.
const isInsideTextBody = (xml: string, offset: number): boolean => {
  const before = xml.slice(0, offset);
  const openRe = /<w:t(?:>| )/g;
  let lastOpen = -1;
  let m: RegExpExecArray | null;
  while ((m = openRe.exec(before)) !== null) lastOpen = m.index;
  const lastClose = before.lastIndexOf('</w:t>');
  return lastOpen > lastClose;
};

// Kinds whose spliced span is THROWAWAY placeholder content that the fill
// overwrites — the box glyph (□), the bracket token, the underscore run. For
// these the preview marker must REPLACE that span, otherwise the raw placeholder
// lingers beside the interactive field span (e.g. "☐□Corporation",
// "[span][INSERT …]", "[span]______"). Label kinds keep their surrounding text:
// TABLE_CELL_LABEL is a zero-width insert into the answer cell, and TEXT_LABEL
// keeps its "Name:" label (the marker goes AFTER it so the value reads
// "Name: <value>", not "<value>Name:").
const MARKER_REPLACE_KINDS = new Set<FillSpotKind>(['CHECKBOX', 'TEXT_TOKEN', 'UNDERSCORE_BLANK']);

// Inject an invisible index marker at each fill spot, returning the marked
// document.xml and the ordered spot metadata (index === position in this list).
//
// A marker inside a <w:t> body (inline tokens/underscores) must be BARE TEXT —
// wrapping it in a <w:r> there would nest a run inside a text element (invalid,
// and mammoth would choke). A marker at a run/paragraph boundary must be a full
// <w:r> so it's valid block content.
export const injectFieldMarkers = (xml: string): { xml: string; spots: FillSpotMeta[] } => {
  const spots = findDocxFillSpots(xml);

  // For each spot compute where the marker goes (`at`) and how much of the
  // original to remove (`at`..`removeEnd`). Apply at descending `at` so earlier
  // offsets stay valid as we mutate the string.
  const edits = spots.map((s, i) => {
    const replace = MARKER_REPLACE_KINDS.has(s.kind);
    const at = s.kind === 'TEXT_LABEL' ? s.spliceEnd : s.spliceStart;
    return { i, at, removeEnd: replace ? s.spliceEnd : at };
  });
  edits.sort((a, b) => b.at - a.at);

  let marked = xml;
  for (const e of edits) {
    const token = `${MARK_OPEN}${e.i}${MARK_CLOSE}`;
    const marker = isInsideTextBody(marked, e.at)
      ? token
      : `<w:r><w:t xml:space="preserve">${token}</w:t></w:r>`;
    marked = marked.slice(0, e.at) + marker + marked.slice(e.removeEnd);
  }
  const meta: FillSpotMeta[] = spots.map((s) => ({ kind: s.kind, ref: s.ref, occurrence: s.occurrence, label: s.label }));
  return { xml: marked, spots: meta };
};

const decodeXmlEntities = (s: string): string =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");

// ── Fill labels (signature/party form fields) ──
// NB: "firm" alone is intentionally NOT here — "FIRM:" is a section/party HEADER
// (used as context for the fields under it), not a blank to fill. "Name of Firm"
// (the actual blank) is included.
const FILL_LABELS = ['name', 'title', 'date', 'by', 'signature', 'company', 'email', 'phone', 'address', 'name of firm', 'printed name', 'authorized signature'];

// True when a piece of text is exactly a fillable label ("Signature:", "Name",
// "Name of Firm"), optionally with a trailing colon and surrounding whitespace.
const asFillLabel = (text: string): string | null => {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!/^[A-Za-z /]{2,40}:?$/.test(t)) return null;
  const bare = t.replace(/:$/, '').trim().toLowerCase();
  return FILL_LABELS.includes(bare) ? t : null;
};

// Tidy a raw context string into a short, human label prefix: drop underscore
// runs and other blank-line filler, collapse whitespace, strip a trailing colon,
// and cap to a handful of words so a long heading doesn't swamp the field name.
const cleanContext = (text: string): string | null => {
  let t = text
    .replace(/_{2,}/g, ' ') // underline blanks
    .replace(/\.{2,}/g, ' ') // dotted leaders
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[:\s]+$/, '');
  if (t.length < 2) return null;
  const words = t.split(' ');
  if (words.length > 6) t = `${words.slice(0, 6).join(' ')}…`;
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
};

// Section/party cue for a human context prefix on duplicate labels.
const sectionContextOf = (text: string): string | null => {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length < 3 || t.length > 80) return null;
  if (/[.]$/.test(t)) return null;
  if (/supplier|vendor|contractor|university|regents|company|customer|client|agency|offeror|bidder|proposer|firm/i.test(t)) {
    return cleanContext(t);
  }
  return null;
};

// ── XML element scanning ──

type Elem = { start: number; end: number; innerStart: number; innerEnd: number };
type Run = { elemStart: number; elemEnd: number; bodyStart: number; bodyEnd: number; text: string };

// All <w:t> runs (with body offsets) within [from, to). Handles self-closing tags.
const runsIn = (xml: string, from = 0, to = xml.length): Run[] => {
  const runs: Run[] = [];
  const re = /<w:t\b[^>]*?(\/)>|<w:t\b[^>]*?>([\s\S]*?)<\/w:t>/g;
  re.lastIndex = from;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m.index >= to) break;
    const elemStart = m.index;
    const elemEnd = re.lastIndex;
    if (m[1] === '/') {
      runs.push({ elemStart, elemEnd, bodyStart: elemEnd, bodyEnd: elemEnd, text: '' });
    } else {
      const bodyStart = xml.indexOf('>', elemStart) + 1;
      const bodyEnd = elemEnd - '</w:t>'.length;
      runs.push({ elemStart, elemEnd, bodyStart, bodyEnd, text: decodeXmlEntities(m[2] ?? '') });
    }
  }
  return runs;
};

// The <w:r>…</w:r> run element that encloses the <w:t> at `tElemStart`, plus the
// inner XML of its <w:rPr> (run properties), if any. Used to re-emit a run with
// the original formatting PLUS an added underline for filled underscore blanks.
const enclosingRun = (
  xml: string,
  tElemStart: number,
): { start: number; end: number; rPrInner: string } | null => {
  const start = xml.lastIndexOf('<w:r>', tElemStart) >= 0
    ? Math.max(xml.lastIndexOf('<w:r>', tElemStart), xml.lastIndexOf('<w:r ', tElemStart))
    : xml.lastIndexOf('<w:r ', tElemStart);
  if (start < 0) return null;
  const end = xml.indexOf('</w:r>', tElemStart);
  if (end < 0) return null;
  const runXml = xml.slice(start, end + '</w:r>'.length);
  const rPr = runXml.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/);
  return { start, end: end + '</w:r>'.length, rPrInner: rPr ? rPr[1] : '' };
};

// Depth-aware scan for balanced <tag>…</tag> elements at the TOP level within
// [from, to) — correctly skips nested same-tag elements (e.g. a table inside a
// table cell), which naive non-greedy regex would mis-close.
const balancedElems = (xml: string, tag: string, from: number, to: number): Elem[] => {
  const re = new RegExp(`<${tag}\\b[^>]*?(/?)>|</${tag}>`, 'g');
  re.lastIndex = from;
  const out: Elem[] = [];
  let depth = 0;
  let openStart = -1;
  let innerStart = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m.index >= to) break;
    const isClose = m[0].startsWith('</');
    const selfClose = m[1] === '/';
    if (selfClose) {
      if (depth === 0) out.push({ start: m.index, end: re.lastIndex, innerStart: re.lastIndex, innerEnd: re.lastIndex });
      continue;
    }
    if (!isClose) {
      if (depth === 0) {
        openStart = m.index;
        innerStart = re.lastIndex;
      }
      depth += 1;
    } else {
      depth -= 1;
      if (depth === 0 && openStart >= 0) {
        out.push({ start: openStart, end: re.lastIndex, innerStart, innerEnd: m.index });
        openStart = -1;
      }
    }
  }
  return out;
};

// Text of a cell's OWN content, excluding any nested table (whose runs would
// otherwise pollute the label/blank detection of the outer cell).
const cellText = (xml: string, cell: Elem): string => {
  const nested = balancedElems(xml, 'w:tbl', cell.innerStart, cell.innerEnd);
  const excluded = (offset: number): boolean => nested.some((t) => offset >= t.start && offset < t.end);
  return runsIn(xml, cell.innerStart, cell.innerEnd)
    .filter((r) => !excluded(r.elemStart))
    .map((r) => r.text)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
};

// How many grid columns a cell spans (<w:gridSpan w:val="N"/> in its <w:tcPr>,
// defaulting to 1). Signature tables often merge header cells across the two
// sub-columns (label | answer), so a header cell can span 2.
const gridSpanOf = (xml: string, cell: Elem): number => {
  // <w:gridSpan> lives in the cell's <w:tcPr>, which is INSIDE the cell (right
  // after innerStart) — not in the opening tag. Read the leading tcPr block.
  const head = xml.slice(cell.innerStart, Math.min(cell.innerEnd, cell.innerStart + 800));
  const m = head.match(/<w:gridSpan\b[^>]*\bw:val="(\d+)"/);
  return m ? Math.max(1, parseInt(m[1], 10)) : 1;
};

// The starting grid column of each physical cell in a row (accounting for spans).
const gridStarts = (xml: string, cells: Elem[]): number[] => {
  const starts: number[] = [];
  let col = 0;
  for (const c of cells) {
    starts.push(col);
    col += gridSpanOf(xml, c);
  }
  return starts;
};

// A cell is a blank answer slot when it has no substantive text (only spaces,
// tabs, underscores or dots — the visual "fill here" line).
const isBlankAnswerCell = (text: string): boolean => /^[\s_.]*$/.test(text);

// ── The finder ──

export const findDocxFillSpots = (xml: string): FillSpot[] => {
  const raw: Omit<FillSpot, 'occurrence'>[] = [];
  const consumed: Array<[number, number]> = []; // XML spans handled as table labels

  // Rolling section context from heading-like runs, by offset.
  const cues = runsIn(xml).map((r) => ({ offset: r.elemStart, ctx: sectionContextOf(r.text) })).filter((c) => c.ctx);
  const contextAt = (offset: number): string | null => {
    let ctx: string | null = null;
    for (const c of cues) {
      if (c.offset < offset) ctx = c.ctx;
      else break;
    }
    return ctx;
  };
  const withCtx = (offset: number, label: string): string => {
    const ctx = contextAt(offset);
    return ctx ? `${ctx} — ${label}` : label;
  };

  // 1. TABLE_CELL_LABEL — label cell whose answer belongs in the next cell.
  // Context comes from the table's HEADER cell in the same column (e.g. a
  // signature table with "FIRM: …" and "ROANOKE …" columns), so side-by-side
  // signature blocks are distinguishable. Falls back to the nearest heading.
  for (const tbl of balancedElems(xml, 'w:tbl', 0, xml.length)) {
    const rows = balancedElems(xml, 'w:tr', tbl.innerStart, tbl.innerEnd);
    // Header cells = the first row's cells whose text is NOT itself a fill label.
    // Map each to its grid-column range so a gridSpan'd header (common in
    // side-by-side signature tables) covers the right physical answer columns.
    const headerCells = rows.length > 0 ? balancedElems(xml, 'w:tc', rows[0].innerStart, rows[0].innerEnd) : [];
    const headerStarts = gridStarts(xml, headerCells);
    const headerCols = headerCells.map((c, k) => ({
      col: headerStarts[k],
      span: gridSpanOf(xml, c),
      text: cellText(xml, c),
    }));
    const tableHasHeader = headerCols.some((h) => h.text.length > 0 && !asFillLabel(h.text));
    const headerForColumn = (col: number): string | null => {
      const h = headerCols.find((hc) => col >= hc.col && col < hc.col + hc.span);
      return h ? h.text : null;
    };

    for (let r = 0; r < rows.length; r += 1) {
      const cells = balancedElems(xml, 'w:tc', rows[r].innerStart, rows[r].innerEnd);
      const colStarts = gridStarts(xml, cells);
      for (let i = 0; i < cells.length; i += 1) {
        const label = asFillLabel(cellText(xml, cells[i]));
        if (!label || i + 1 >= cells.length) continue;
        const answer = cells[i + 1];
        if (!isBlankAnswerCell(cellText(xml, answer))) continue;
        // Context: header cell covering this label's grid column (skip when this
        // row IS the header), else the row's leading non-label cell, else the
        // nearest doc heading.
        let ctx: string | null = null;
        if (tableHasHeader && r > 0) {
          const h = headerForColumn(colStarts[i]);
          if (h) ctx = cleanContext(h);
        }
        // Leading-cell fallback: only borrow a same-row cell that reads like a
        // party/section name (not another field value or a bare label), so we
        // don't produce noise like "Date — Signature:".
        if (!ctx) {
          const lead = cells
            .slice(0, i)
            .map((c) => cellText(xml, c))
            .find((t) => t && !asFillLabel(t) && sectionContextOf(t) !== null);
          if (lead) ctx = cleanContext(lead);
        }
        if (!ctx) ctx = contextAt(cells[i].start);
        const insertAt = balancedElems(xml, 'w:p', answer.innerStart, answer.innerEnd)[0]?.innerEnd;
        if (insertAt === undefined) continue;
        raw.push({
          kind: 'TABLE_CELL_LABEL',
          ref: label,
          label: ctx ? `${ctx} — ${label}` : label,
          markType: 'TEXT',
          spliceStart: insertAt,
          spliceEnd: insertAt,
          render: (v) => `<w:r><w:t xml:space="preserve">${escapeXml(v)}</w:t></w:r>`,
        });
        consumed.push([cells[i].start, answer.end]);
      }
    }
  }

  const inConsumed = (offset: number): boolean => consumed.some(([s, e]) => offset >= s && offset < e);

  // 2. Same-line TEXT_LABEL and UNDERSCORE_BLANK.
  // Build a paragraph list first so underscore blanks can borrow a caption from
  // an ADJACENT paragraph (many forms put "____" on one line and its caption —
  // "Name of Firm" — on the next).
  const paras = balancedElems(xml, 'w:p', 0, xml.length)
    .filter((p) => !inConsumed(p.start))
    .map((p) => {
      const runs = runsIn(xml, p.innerStart, p.innerEnd);
      return { p, runs, text: runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim() };
    });

  const captionParaText = (idx: number): string | null => {
    // Prefer the following paragraph's caption, then the previous one.
    for (const j of [idx + 1, idx - 1]) {
      const t = paras[j]?.text;
      if (t && t.length > 1 && !/^_{3,}$/.test(t)) return t;
    }
    return null;
  };

  for (let pi = 0; pi < paras.length; pi += 1) {
    const { p, runs, text: paraText } = paras[pi];
    if (runs.length === 0) continue;

    // Same-line label: the WHOLE paragraph is just the label (+ optional blank
    // whitespace). This guard rejects header/prose like "Title: WEBSITE ...".
    // Skip a paragraph that is purely a caption for an adjacent underscore line
    // (handled as UNDERSCORE_BLANK below) so we don't double-count it.
    const label = asFillLabel(paraText);
    const isCaptionForNeighbourBlank =
      /^_{3,}$/.test(paras[pi - 1]?.text ?? '') || /^_{3,}$/.test(paras[pi + 1]?.text ?? '');
    if (label && !isCaptionForNeighbourBlank) {
      const target = runs.find((r) => r.text.includes(':')) ?? runs.find((r) => r.text.trim().length > 0);
      if (target) {
        raw.push({
          kind: 'TEXT_LABEL',
          ref: label,
          label: withCtx(p.start, label),
          markType: 'TEXT',
          spliceStart: target.elemStart,
          spliceEnd: target.elemEnd,
          render: (v) => `<w:t xml:space="preserve">${escapeXml(`${label} ${v}`)}</w:t>`,
        });
      }
      continue;
    }

    for (let i = 0; i < runs.length; i += 1) {
      const run = runs[i];

      // (a) STANDALONE underscore run: the whole run is just underscores.
      // Caption = nearest non-empty neighbour run, else an adjacent paragraph.
      if (/^_{3,}$/.test(run.text.trim())) {
        const rawCaption =
          runs.slice(i + 1).find((r) => r.text.trim().length > 1)?.text.trim() ??
          runs.slice(0, i).reverse().find((r) => r.text.trim().length > 1)?.text.trim() ??
          captionParaText(pi) ??
          'Blank';
        // Two-column tab layouts glue a left caption to a right one (e.g.
        // "Street or Box Number\tIFB No./RFP No."). Keep only the first segment.
        const caption = cleanContext(rawCaption.split(/\t|\s{2,}/)[0]) ?? rawCaption;
        // Replace the WHOLE underscore run so we can add underline formatting.
        const encl = enclosingRun(xml, run.elemStart);
        const rPrInner = encl ? encl.rPrInner.replace(/<w:u\b[^>]*\/?>/g, '') : '';
        raw.push({
          kind: 'UNDERSCORE_BLANK',
          ref: caption,
          label: withCtx(run.elemStart, caption),
          markType: 'TEXT',
          spliceStart: encl ? encl.start : run.elemStart,
          spliceEnd: encl ? encl.end : run.elemEnd,
          render: (v) =>
            `<w:r><w:rPr>${rPrInner}<w:u w:val="single"/></w:rPr>` +
            `<w:t xml:space="preserve">${escapeXml(`${v}    `)}</w:t></w:r>`,
        });
        continue;
      }

      // (b) INLINE underscore blank(s): underscores embedded WITHIN a run's text,
      // e.g. "eMail:______", "Certification No.____ and Expiration Date:____",
      // "NAME OF FIRM/OFFEROR:____". Splice just the underscore span (inside the
      // <w:t> body) so the surrounding label text is preserved. A run can hold
      // several blanks (each its own field); walk them left→right, and use the
      // label text immediately BEFORE each blank as its caption.
      const body = run.text;
      if (!/_{3,}/.test(body)) continue;
      // Map decoded-text indices onto raw XML body offsets. The body may contain
      // entities; only '&','<','>' expand, and underscores never do, so we scan
      // the RAW body for underscore runs and derive captions from decoded slices.
      const rawBody = xml.slice(run.bodyStart, run.bodyEnd);
      const blankRe = /_{3,}/g;
      let bm: RegExpExecArray | null;
      while ((bm = blankRe.exec(rawBody)) !== null) {
        const start = run.bodyStart + bm.index;
        const end = start + bm[0].length;
        // Caption: the text just before this blank in the run (up to the previous
        // blank / start), trimmed to its trailing "Label:" or last few words.
        const preceding = decodeXmlEntities(rawBody.slice(0, bm.index)).replace(/_{3,}/g, ' ');
        const seg = preceding.split(/\t|\s{2,}/).pop() ?? preceding;
        const caption =
          cleanContext(seg) ??
          runs.slice(0, i).reverse().find((r) => r.text.trim().length > 1)?.text.trim() ??
          captionParaText(pi) ??
          'Blank';
        raw.push({
          kind: 'UNDERSCORE_BLANK',
          ref: caption,
          label: withCtx(run.elemStart, caption),
          markType: 'TEXT',
          spliceStart: start,
          spliceEnd: end,
          // In-body splice: we replace only the underscore characters, INSIDE the
          // existing <w:t>, so the label before it is preserved. Run props can't
          // be changed mid-text, so instead of underline styling we write the
          // value followed by a short underscore remainder — it keeps the
          // fill-in-the-blank look and inherits the run's font. (Underline
          // styling is applied only for standalone blanks, case (a).)
          render: (v) => escapeXml(`${v} ____`),
        });
      }
    }
  }

  // 3. TEXT_TOKEN — bracket placeholders inside any run (not consumed).
  const TOKEN_RE = /\[[^\]\r\n]{1,60}\]/g;
  for (const run of runsIn(xml)) {
    if (inConsumed(run.elemStart)) continue;
    for (const tm of run.text.matchAll(TOKEN_RE)) {
      const token = tm[0];
      if (!/[A-Za-z]/.test(token)) continue;
      // Offset of the token within the run body, mapped to the raw XML. The run
      // body may contain entities; recompute against the raw (encoded) body.
      const rawBody = xml.slice(run.bodyStart, run.bodyEnd);
      const idx = rawBody.indexOf(token);
      if (idx < 0) continue;
      const start = run.bodyStart + idx;
      raw.push({
        kind: 'TEXT_TOKEN',
        ref: token,
        label: humanizeToken(token),
        markType: 'TEXT',
        spliceStart: start,
        spliceEnd: start + token.length,
        render: (v) => escapeXml(v),
      });
    }
  }

  // 4. CHECKBOX — text checkbox glyphs (□ U+25A1 / ☐ U+2610) with an option
  //    label. The box is usually just before its label ("□Corporation",
  //    "□ Yes"); some forms lead a paragraph with the box ("☐ is a corporation
  //    …"). We splice ONLY the box glyph; ticking swaps it for ☒ (U+2612).
  const BOX_CHARS = '□☐'; // □ ☐
  const allRuns = runsIn(xml);
  for (let ri = 0; ri < allRuns.length; ri += 1) {
    const run = allRuns[ri];
    if (inConsumed(run.elemStart)) continue;
    if (!new RegExp(`[${BOX_CHARS}]`).test(run.text)) continue;
    const rawBody = xml.slice(run.bodyStart, run.bodyEnd);
    const localRe = new RegExp(`[${BOX_CHARS}]`, 'g');
    let cm: RegExpExecArray | null;
    let lastBoxIdx = -1;
    while ((cm = localRe.exec(rawBody)) !== null) {
      const start = run.bodyStart + cm.index;
      lastBoxIdx = cm.index;
      // Label = text immediately AFTER the box in THIS run, up to the next
      // box / tab. If the box is its own run (common: "□" then "Yes" in the
      // next run), borrow the following run's leading text.
      let optLabel = decodeXmlEntities(rawBody.slice(cm.index + 1))
        .split(new RegExp(`[${BOX_CHARS}\\t]`))[0]
        .replace(/\s+/g, ' ')
        .trim();
      if (!optLabel) {
        const next = allRuns[ri + 1];
        if (next) optLabel = next.text.split(new RegExp(`[${BOX_CHARS}\\t]`))[0].replace(/\s+/g, ' ').trim();
      }
      optLabel = optLabel.length > 48 ? `${optLabel.slice(0, 48)}…` : optLabel;
      if (!optLabel) optLabel = 'Check box';
      // Checkbox option labels are self-explanatory ("Corporation", "Yes") — the
      // rolling section heading is usually a distant, unrelated line, so don't
      // prefix it. Use the option text directly as the field label.
      raw.push({
        kind: 'CHECKBOX',
        ref: optLabel,
        label: optLabel,
        markType: 'CHECKBOX',
        spliceStart: start,
        spliceEnd: start + 1, // just the box glyph
        // value is the mark char (☒) when ticked; empty leaves the box as-is.
        render: (v) => escapeXml(v && v.trim() ? '☒' : '□'),
      });
    }
    void lastBoxIdx;
  }

  // Order by position, then assign per-(kind,ref) occurrence indices.
  raw.sort((a, b) => a.spliceStart - b.spliceStart);
  const counts = new Map<string, number>();
  return raw.map((s) => {
    const key = `${s.kind} ${s.ref}`;
    const occurrence = counts.get(key) ?? 0;
    counts.set(key, occurrence + 1);
    return { ...s, occurrence };
  });
};

const humanizeToken = (raw: string): string => {
  const inner = raw.replace(/^\[|\]$/g, '').trim();
  const cleaned = inner.replace(/^(INSERT|ENTER|TYPE|ADD)\s+/i, '').trim();
  return cleaned.length > 0 ? cleaned : inner;
};
