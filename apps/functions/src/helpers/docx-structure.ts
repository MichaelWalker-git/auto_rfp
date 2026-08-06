import JSZip from 'jszip';

import { findDocxFillSpots } from './docx-fill-spots';

import type { DocxAnchor, DocxFillStrategy, FieldMarkType } from '@auto-rfp/core';

/**
 * A fillable form control discovered by structural analysis of a DOCX. Carries
 * the anchor the in-place filler uses to write a value back, plus a best-effort
 * label and mark type for the field list / editor.
 */
export type DocxStructuredField = {
  anchor: DocxAnchor;
  label: string;
  markType: FieldMarkType;
};

export type DocxStructureResult = {
  strategy: DocxFillStrategy;
  structuredFields: DocxStructuredField[];
};

// SDT control kinds that represent a REAL fillable form control. Everything
// else (docPartObj/docPartList = TOC/galleries, bibliography, plain/untyped
// wrappers) is not a form field and must not be counted.
const FILLABLE_SDT_KINDS = [
  'w:text',
  'w:checkbox',
  'w:dropDownList',
  'w:comboBox',
  'w:date',
  'w:picture',
] as const;

// Structural (non-fillable) SDT kinds we explicitly reject.
const NON_FILLABLE_SDT_KINDS = ['w:docPartObj', 'w:docPartList', 'w:bibliography'] as const;

// Google Docs round-trips emit <w:sdt> wrappers tagged `goog_rdk_*` around
// suggestion / tracked-change fragments (one can wrap a single comma). They are
// NOT form fields — the real sample form is entirely these — so reject them
// regardless of kind.
const isGoogleSuggestionTag = (tag: string | null): boolean =>
  tag !== null && /^goog_rdk_/i.test(tag);

const attrVal = (block: string, attr: string): string | null => {
  const m = block.match(new RegExp(`<${attr}[^>]*\\bw:val="([^"]*)"`));
  return m ? m[1] : null;
};

const sdtKind = (props: string): (typeof FILLABLE_SDT_KINDS)[number] | 'NON_FILLABLE' | 'PLAIN' => {
  for (const kind of NON_FILLABLE_SDT_KINDS) {
    if (props.includes(`<${kind}`)) return 'NON_FILLABLE';
  }
  for (const kind of FILLABLE_SDT_KINDS) {
    if (props.includes(`<${kind}`)) return kind;
  }
  return 'PLAIN';
};

/**
 * Analyze a DOCX buffer and decide how it should be filled.
 *
 * Both strategies fill the ORIGINAL document in place — neither generates a
 * separate document.
 *
 * IN_PLACE: the document contains real fillable content controls (`<w:sdt>` of a
 *   whitelisted kind) or legacy form fields (FORMTEXT). Each yields a
 *   `DocxStructuredField` whose anchor the filler writes back into. This wins
 *   whenever any real control exists.
 *
 * TEXT_TOKEN: no real controls, but the prose carries inline placeholder tokens
 *   (e.g. `[INSERT SUPPLIER NAME]`, `[Title of Agreement]`). Each becomes a
 *   field whose anchor is the literal token text; the filler find-and-replaces
 *   it in its run, preserving all surrounding formatting. This is the common
 *   case for contract-style forms (including the sample addendum).
 *
 * When neither yields fields, we still return TEXT_TOKEN with an empty list:
 * the LLM-over-text pass may surface labels (signatures, "Name:"/"Date:") that
 * have no fillable spot — those are left as-is in the original and flagged for
 * manual completion. The original is never corrupted.
 *
 * Detection is deliberately conservative: unknown/plain/structural SDTs and
 * `goog_rdk_*` suggestion wrappers are NOT counted as fields.
 */
export const detectDocxStructure = async (buffer: Buffer): Promise<DocxStructureResult> => {
  const zip = await JSZip.loadAsync(buffer);
  const documentXml = await zip.file('word/document.xml')?.async('string');
  if (!documentXml) return { strategy: 'TEXT_TOKEN', structuredFields: [] };

  const structuredFields: DocxStructuredField[] = [];

  // ── Content controls (<w:sdt>) ──
  // Match each control's properties block. `<w:sdtPr> … </w:sdtPr>` holds the
  // kind, id, tag and alias; that's all we need to classify and anchor.
  const sdtPrRegex = /<w:sdtPr>([\s\S]*?)<\/w:sdtPr>/g;
  let match: RegExpExecArray | null;
  while ((match = sdtPrRegex.exec(documentXml)) !== null) {
    const props = match[1];
    const tag = attrVal(props, 'w:tag');
    if (isGoogleSuggestionTag(tag)) continue;

    const kind = sdtKind(props);
    if (kind === 'NON_FILLABLE' || kind === 'PLAIN') continue;

    const id = attrVal(props, 'w:id');
    if (!id) continue; // no stable anchor → cannot fill in place, skip

    const alias = attrVal(props, 'w:alias');
    const sourceLabel = alias ?? tag;
    structuredFields.push({
      anchor: { kind: 'SDT', ref: id, occurrence: null, sourceLabel },
      label: sourceLabel ?? 'Field',
      markType: kind === 'w:checkbox' ? 'CHECKBOX' : 'TEXT',
    });
  }

  // ── Legacy form fields (FORMTEXT via <w:fldChar> + bookmark) ──
  // Legacy text form fields are wrapped in a bookmark; the bookmark name is the
  // stable anchor. Match FORMTEXT instructions and pair them with the nearest
  // preceding bookmarkStart name.
  if (documentXml.includes('FORMTEXT')) {
    const bookmarkRegex = /<w:bookmarkStart[^>]*\bw:name="([^"]*)"[^>]*\/?>([\s\S]*?)<w:bookmarkEnd/g;
    let bm: RegExpExecArray | null;
    while ((bm = bookmarkRegex.exec(documentXml)) !== null) {
      const [, name, inner] = bm;
      if (!name || !inner.includes('FORMTEXT')) continue;
      structuredFields.push({
        anchor: { kind: 'LEGACY_FORMFIELD', ref: name, occurrence: null, sourceLabel: name },
        label: name,
        markType: 'TEXT',
      });
    }
  }

  // Real controls win outright.
  if (structuredFields.length > 0) {
    return { strategy: 'IN_PLACE', structuredFields };
  }

  // ── Prose fill spots (no structured controls) ──
  // Delegate to the shared fill-spot finder — the SAME pass the filler uses — so
  // detection and fill agree on every spot's (kind, ref, occurrence). Covers
  // bracket tokens, same-line label blanks, table label→answer-cell pairs, and
  // underscore blanks with adjacent captions.
  //
  // TEXT_TOKENs are DEDUPED to one field per distinct token (a token like
  // "[INSERT SUPPLIER NAME]" may recur; the user fills it once and the filler
  // writes every occurrence). Label/cell/underscore spots stay per-occurrence —
  // each is an independent blank the user fills separately.
  const spots = findDocxFillSpots(documentXml);
  const seenTokens = new Set<string>();
  const proseFields: DocxStructuredField[] = [];
  for (const spot of spots) {
    if (spot.kind === 'TEXT_TOKEN') {
      if (seenTokens.has(spot.ref)) continue;
      seenTokens.add(spot.ref);
      proseFields.push({
        anchor: { kind: 'TEXT_TOKEN', ref: spot.ref, occurrence: null, sourceLabel: spot.label },
        label: spot.label,
        markType: spot.markType,
      });
    } else {
      proseFields.push({
        anchor: { kind: spot.kind, ref: spot.ref, occurrence: spot.occurrence, sourceLabel: spot.label },
        label: spot.label,
        markType: spot.markType,
      });
    }
  }
  return { strategy: 'TEXT_TOKEN', structuredFields: proseFields };
};
