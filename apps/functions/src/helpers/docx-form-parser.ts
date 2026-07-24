import { v4 as uuidv4 } from 'uuid';

import { invokeModel } from './bedrock-http-client';
import { safeParseJsonFromModel } from './json';
import { requireEnv } from './env';
import { getCompanyProfile } from './company-profile';
import { autofillFieldsWithTools } from './autofill-fields-with-tools';

import type { DetectedFormField } from '@auto-rfp/core';

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
    max_tokens: 4000,
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
  if (!rawText) return [];

  let modelOut: Record<string, unknown> | null;
  try {
    modelOut = safeParseJsonFromModel(String(rawText)) as Record<string, unknown>;
  } catch {
    return [];
  }
  if (!modelOut) return [];

  const rawFields = Array.isArray(modelOut.fields) ? (modelOut.fields as ExtractedField[]) : [];

  const fields: DetectedFormField[] = [];
  for (const raw of rawFields) {
    const label = typeof raw?.label === 'string' ? raw.label.trim() : '';
    if (!label) continue;
    const pageNumber = typeof raw?.pageNumber === 'number' ? raw.pageNumber : null;
    fields.push({
      fieldId: uuidv4(),
      label,
      value: null,
      status: 'EMPTY',
      confidence: null,
      profileFieldKey: null,
      manualReason: null,
      pageNumber,
      cellReference: null,
      boundingBox: null,
      markType: 'TEXT',
      markChar: null,
      markGeometry: null,
      matrixCategory: null,
      matrixFeature: null,
      matrixColumn: 'OTHER',
    });
    if (fields.length >= MAX_FIELDS) break;
  }

  return fields;
};

export type DocxFormResult = {
  fields: DetectedFormField[];
  totalFieldCount: number;
  manualFieldCount: number;
  autoFillPercentage: number;
};

/**
 * Full DOCX form processing: extract fields from the document text, then
 * autofill them from the org's company profile. Shared by the detect-required-
 * forms pipeline step and the reprocess handler so both produce identical
 * results. Returns the fields plus the derived counts the caller persists.
 */
export const extractAndAutofillDocxForm = async (
  docText: string,
  orgId: string,
): Promise<DocxFormResult> => {
  let fields = await parseDocxForms(docText);
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

  return { fields, totalFieldCount, manualFieldCount, autoFillPercentage };
};
