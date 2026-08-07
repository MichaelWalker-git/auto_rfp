import JSZip from 'jszip';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

import { uploadToS3 } from './s3';
import { requireEnv } from './env';
import { findDocxFillSpots } from './docx-fill-spots';

import type { DetectedFormField, DocxFillStrategy } from '@auto-rfp/core';

const s3 = new S3Client({});
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// XML-escape a value before injecting it into document.xml.
const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const escapeRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The concrete text a field contributes, or null when it shouldn't be written.
const fieldValue = (field: DetectedFormField): string | null => {
  if (field.markType === 'CHECKBOX' || field.markType === 'CIRCLE') {
    return field.value ? (field.markChar ?? 'X') : null;
  }
  return field.value && field.value.trim() !== '' ? field.value : null;
};

/**
 * Fill a DOCX form by writing values into the ORIGINAL document.
 *
 * Both fill strategies edit `word/document.xml` in place inside the original
 * archive, so every byte of formatting, layout and surrounding text is
 * preserved — only the filled values change. There is NO separate/generated
 * document.
 *
 * - SDT (IN_PLACE): replace the text run inside the content control whose
 *   <w:sdtPr> carries the matching <w:id w:val>.
 * - LEGACY_FORMFIELD (IN_PLACE): replace the run text between the field's
 *   bookmark start/end.
 * - TEXT_TOKEN: find the literal placeholder text (e.g. "[INSERT SUPPLIER
 *   NAME]") inside a run and replace it with the value, in place.
 *
 * Fields with no value or no resolvable anchor are left untouched — the
 * original placeholder/blank stays, to be completed manually. The document is
 * never corrupted by a missed match.
 *
 * `strategy` is accepted for symmetry/telemetry but the filler routes purely on
 * each field's `docxAnchor.kind`, so a form with mixed anchors fills correctly.
 */
export const fillDocxForm = async (args: {
  sourceFileKey: string;
  fields: DetectedFormField[];
  // Accepted for symmetry with the XLSX/PDF fillers and for telemetry; routing
  // is done per-field on `docxAnchor.kind`, so mixed-anchor forms fill correctly.
  strategy: DocxFillStrategy;
  outputKey: string;
  formName: string;
}): Promise<string> => {
  const { sourceFileKey, fields, outputKey } = args;

  const s3Obj = await s3.send(new GetObjectCommand({ Bucket: getDocumentsBucket(), Key: sourceFileKey }));
  const bytes = await s3Obj.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Could not read DOCX from S3: ${sourceFileKey}`);

  const zip = await JSZip.loadAsync(Buffer.from(bytes));
  let xml = await zip.file('word/document.xml')?.async('string');
  if (!xml) throw new Error('DOCX has no word/document.xml');

  // ── Structured controls (SDT / FORMTEXT) — targeted string replacers. ──
  for (const field of fields) {
    const anchor = field.docxAnchor;
    if (!anchor) continue;
    const value = fieldValue(field);
    if (value === null) continue;
    if (anchor.kind === 'SDT') xml = replaceSdtContent(xml, anchor.ref, value);
    else if (anchor.kind === 'LEGACY_FORMFIELD') xml = replaceBookmarkText(xml, anchor.ref, value);
  }

  // ── Prose spots (tokens, labels, table cells, underscore blanks). ──
  // Re-run the SAME finder detection used, so every field's (kind, ref,
  // occurrence) resolves to the exact XML span the finder identified. Collect a
  // splice per filled field, then apply in DESCENDING offset order so earlier
  // offsets stay valid as we mutate the string.
  const PROSE_KINDS = new Set(['TEXT_TOKEN', 'TEXT_LABEL', 'TABLE_CELL_LABEL', 'UNDERSCORE_BLANK', 'CHECKBOX']);
  const proseFields = fields.filter((f) => f.docxAnchor && PROSE_KINDS.has(f.docxAnchor.kind) && fieldValue(f) !== null);
  if (proseFields.length > 0) {
    const spots = findDocxFillSpots(xml);
    const spotByKey = new Map<string, (typeof spots)[number]>();
    for (const s of spots) spotByKey.set(`${s.kind} ${s.ref} ${s.occurrence}`, s);

    const edits: Array<{ start: number; end: number; text: string }> = [];
    for (const f of proseFields) {
      const a = f.docxAnchor!;
      const value = fieldValue(f)!;
      if (a.kind === 'TEXT_TOKEN') {
        // Deduped to one field → fill EVERY occurrence of the token.
        for (const s of spots) {
          if (s.kind === 'TEXT_TOKEN' && s.ref === a.ref) {
            edits.push({ start: s.spliceStart, end: s.spliceEnd, text: s.render(value) });
          }
        }
      } else {
        const spot = spotByKey.get(`${a.kind} ${a.ref} ${a.occurrence ?? 0}`);
        if (!spot) continue; // spot no longer present (doc changed) → skip, don't corrupt
        edits.push({ start: spot.spliceStart, end: spot.spliceEnd, text: spot.render(value) });
      }
    }
    edits.sort((x, y) => y.start - x.start); // descending so offsets stay valid
    for (const e of edits) xml = xml.slice(0, e.start) + e.text + xml.slice(e.end);
  }

  zip.file('word/document.xml', xml);
  const out = await zip.generateAsync({ type: 'nodebuffer' });
  await uploadToS3(getDocumentsBucket(), outputKey, out, DOCX_MIME);
  return outputKey;
};

// Replace the text of the first <w:t> inside the <w:sdtContent> of the content
// control whose <w:sdtPr> holds w:id=`id`. Leaves the run's formatting intact.
const replaceSdtContent = (xml: string, id: string, value: string): string => {
  const sdtRegex = /<w:sdt\b[\s\S]*?<\/w:sdt>/g;
  return xml.replace(sdtRegex, (block) => {
    if (!new RegExp(`<w:id[^>]*\\bw:val="${escapeRegex(id)}"`).test(block)) return block;
    if (/<w:t[ >]/.test(block) || /<w:t\/>/.test(block)) {
      let replaced = false;
      return block.replace(/<w:t\b[^>]*\/>|<w:t\b[^>]*>[\s\S]*?<\/w:t>/, (t) => {
        if (replaced) return t;
        replaced = true;
        return `<w:t xml:space="preserve">${escapeXml(value)}</w:t>`;
      });
    }
    return block.replace(
      /<w:sdtContent>([\s\S]*?)<\/w:sdtContent>/,
      `<w:sdtContent><w:r><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r></w:sdtContent>`,
    );
  });
};

// Replace the first run's text between a bookmarkStart/​bookmarkEnd named `name`.
const replaceBookmarkText = (xml: string, name: string, value: string): string => {
  const bmRegex = new RegExp(
    `(<w:bookmarkStart[^>]*\\bw:name="${escapeRegex(name)}"[^>]*/?>)([\\s\\S]*?)(<w:bookmarkEnd)`,
  );
  return xml.replace(bmRegex, (_full, start: string, inner: string, end: string) => {
    let replaced = false;
    const newInner = inner.replace(/<w:t\b[^>]*\/>|<w:t\b[^>]*>[\s\S]*?<\/w:t>/, (t) => {
      if (replaced) return t;
      replaced = true;
      return `<w:t xml:space="preserve">${escapeXml(value)}</w:t>`;
    });
    const injected = replaced
      ? newInner
      : `<w:r><w:t xml:space="preserve">${escapeXml(value)}</w:t></w:r>${newInner}`;
    return `${start}${injected}${end}`;
  });
};

