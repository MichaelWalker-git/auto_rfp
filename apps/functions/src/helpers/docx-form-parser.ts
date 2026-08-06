import { v4 as uuidv4 } from 'uuid';

import { invokeModel } from './bedrock-http-client';
import { safeParseJsonFromModel } from './json';
import { requireEnv } from './env';
import { getCompanyProfile } from './company-profile';
import { autofillFieldsWithTools } from './autofill-fields-with-tools';
import { detectDocxStructure, type DocxStructuredField } from './docx-structure';

import type { DetectedFormField, DocxFillStrategy } from '@auto-rfp/core';

const getBedrockModelId = () => requireEnv('BEDROCK_MODEL_ID');

// Cap fields so a runaway model response can't produce thousands of rows.
const MAX_FIELDS = 200;

type ExtractedField = {
  label?: unknown;
  pageNumber?: unknown;
};

const buildFieldExtractionPrompt = (docText: string) => {
  const userText =
    'The following text was extracted from a Word (.docx) vendor form in a government solicitation.\n' +
    'Identify every distinct field the vendor must fill in — the blanks, labelled lines, and cells that expect ' +
    'vendor-entered information (company name, address, EIN/UEI, contact, title, date, signature blocks, etc.).\n\n' +
    'Rules:\n' +
    '- Return one entry per fillable field, in the order they appear.\n' +
    '- Use the visible label as written (e.g. "Company Name", "Authorized Signature", "Date").\n' +
    '- Do NOT invent fields that have no blank/line/cell to complete.\n' +
    '- Include signature and date fields — they are still fields (they get flagged for manual completion later).\n\n' +
    'Return ONLY JSON: { "fields": [ { "label": string } ] }\n' +
    'If there are no fillable fields, return { "fields": [] }.\n\n' +
    'DOCUMENT TEXT:\n' +
    docText.slice(0, 150_000);

  return {
    anthropic_version: 'bedrock-2023-05-31',
    system:
      'You extract the fillable fields from vendor forms in government solicitation documents. ' +
      'Return ONLY valid JSON (no markdown, no commentary).',
    messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
    temperature: 0,
    // Headroom for the MAX_FIELDS (200) cap: each field entry is small JSON, but
    // a large form's full list can exceed 4k tokens and truncate → parse failure.
    max_tokens: 16000,
  };
};

/**
 * Extract fillable fields from the plain text of a DOCX form using Bedrock.
 *
 * DOCX forms have no Textract/PDF geometry, so fields carry a null boundingBox
 * and are surfaced as a plain field list in the UI. Values start EMPTY; the
 * caller runs company-profile autofill (autofillFieldsWithTools) over the
 * result, which decides AUTO_FILLED / MANUAL_REQUIRED per field.
 */
export const parseDocxForms = async (docText: string): Promise<DetectedFormField[]> => {
  if (!docText || docText.trim().length === 0) return [];

  const responseBody = await invokeModel(
    getBedrockModelId(),
    JSON.stringify(buildFieldExtractionPrompt(docText)),
  );
  const responseJson = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as Record<string, unknown>;
  const contentBlocks = (responseJson?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
  const rawText = contentBlocks.find((c) => c?.type === 'text')?.text ?? null;
  if (!rawText) {
    // Empty model envelope is a hard failure, not a field-less document — throw
    // so the caller marks the form FAILED rather than silently READY with 0 fields.
    throw new Error('DOCX field extraction returned an empty model response');
  }

  // A JSON parse failure here (e.g. a truncated response when the field list
  // overflows max_tokens) must NOT masquerade as "no fields detected". Throw so
  // the caller records FAILED; only a well-formed { fields: [] } means field-less.
  const modelOut = safeParseJsonFromModel(String(rawText)) as Record<string, unknown> | null;
  if (!modelOut) {
    throw new Error('DOCX field extraction returned unparseable model output');
  }

  const rawFields = Array.isArray(modelOut.fields) ? (modelOut.fields as ExtractedField[]) : [];

  const fields: DetectedFormField[] = [];
  for (const raw of rawFields) {
    const label = typeof raw?.label === 'string' ? raw.label.trim() : '';
    if (!label) continue;
    const pageNumber = typeof raw?.pageNumber === 'number' ? raw.pageNumber : null;
    fields.push(makeDocxField({ label, pageNumber }));
    if (fields.length >= MAX_FIELDS) break;
  }

  return fields;
};

// Build an empty DOCX DetectedFormField with the shared defaults. `docxAnchor`
// is null for LLM-surfaced manual-only labels (no fillable spot) and populated
// for structured controls / text tokens. DOCX forms have no PDF/XLSX geometry,
// so boundingBox, cellReference and sheet identity are always null.
const makeDocxField = (args: {
  label: string;
  pageNumber?: number | null;
  markType?: DetectedFormField['markType'];
  docxAnchor?: DetectedFormField['docxAnchor'];
}): DetectedFormField => ({
  fieldId: uuidv4(),
  label: args.label,
  value: null,
  status: 'EMPTY',
  confidence: null,
  profileFieldKey: null,
  manualReason: null,
  pageNumber: args.pageNumber ?? null,
  cellReference: null,
  sheetName: null,
  sheetIndex: null,
  boundingBox: null,
  markType: args.markType ?? 'TEXT',
  markChar: null,
  markGeometry: null,
  matrixCategory: null,
  matrixFeature: null,
  matrixColumn: 'OTHER',
  docxAnchor: args.docxAnchor ?? null,
});

// Convert structured controls found by detectDocxStructure into DetectedFormFields,
// preserving each control's write-back anchor for the in-place filler.
const buildStructuredFields = (structured: DocxStructuredField[]): DetectedFormField[] =>
  structured
    .slice(0, MAX_FIELDS)
    .map((s) => makeDocxField({ label: s.label, markType: s.markType, docxAnchor: s.anchor }));

export type DocxFormResult = {
  fields: DetectedFormField[];
  totalFieldCount: number;
  manualFieldCount: number;
  autoFillPercentage: number;
  // How this form is filled. Both strategies write into the ORIGINAL document.
  // IN_PLACE = real content controls / FORMTEXT; TEXT_TOKEN = prose placeholders.
  docxFillStrategy: DocxFillStrategy;
};

/**
 * Full DOCX form processing: detect the document's structure, extract fields,
 * then autofill them from the org's company profile. Shared by the detect-
 * required-forms pipeline step and the reprocess handler so both produce
 * identical results. Both strategies fill the ORIGINAL document — nothing
 * generates a separate document.
 *
 * - IN_PLACE: the DOCX has real fillable content controls / legacy form fields.
 *   Fields are built from those controls with a write-back anchor.
 * - TEXT_TOKEN: a prose doc. Fillable fields are the detected bracket
 *   placeholders (anchored on the literal token). We ALSO run the LLM over the
 *   text to surface labels with no placeholder (signature/date/name lines) and
 *   add any that aren't already covered as anchor-less fields — these are left
 *   blank in the original and flagged for manual completion.
 *
 * Autofill runs identically in both branches. `buffer` is the raw .docx bytes
 * (needed for structure detection); `docText` is its mammoth-extracted text.
 */
export const extractAndAutofillDocxForm = async (
  buffer: Buffer,
  docText: string,
  orgId: string,
): Promise<DocxFormResult> => {
  const { strategy, structuredFields } = await detectDocxStructure(buffer);

  let fields: DetectedFormField[];
  if (strategy === 'IN_PLACE') {
    fields = buildStructuredFields(structuredFields);
  } else {
    // TEXT_TOKEN. Every fillable spot in a prose form is either a bracket token
    // or a label blank — both caught by structural detection, both anchored and
    // exportable. So when detection found ANY field, trust it exclusively.
    //
    // We do NOT also run the LLM pass in that case: it re-describes the same
    // spots in different words ("Supplier By" vs "[INSERT SUPPLIER NAME] — By:"),
    // which dedup can't reliably match, producing ANCHOR-LESS duplicates that
    // silently do nothing on export. Only fall back to the LLM when detection
    // found nothing at all, so a doc with no recognizable structure still yields
    // a best-effort (manual-only) field list.
    const anchored = buildStructuredFields(structuredFields);
    fields = anchored.length > 0
      ? anchored.slice(0, MAX_FIELDS)
      : (await parseDocxForms(docText)).slice(0, MAX_FIELDS);
  }

  if (fields.length > 0) {
    const profile = await getCompanyProfile(orgId);
    if (profile) {
      fields = await autofillFieldsWithTools(fields, profile);
    }
  }

  const totalFieldCount = fields.length;
  const manualFieldCount = fields.filter((f) => f.status === 'MANUAL_REQUIRED').length;
  const autoFilled = fields.filter((f) => f.status === 'AUTO_FILLED').length;
  const autoFillPercentage = totalFieldCount > 0 ? Math.round((autoFilled / totalFieldCount) * 100) : 0;

  return { fields, totalFieldCount, manualFieldCount, autoFillPercentage, docxFillStrategy: strategy };
};
