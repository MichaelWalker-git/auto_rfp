import * as XLSX from 'xlsx';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

import { invokeModel } from './bedrock-http-client';
import { requireEnv } from './env';
import { extractPdfStructure, structureToJson } from './pdf-to-html';

import type { DetectedFormField, CompanyProfileItem } from '@auto-rfp/core';

const s3 = new S3Client({});
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');
const getBedrockModelId = () => requireEnv('BEDROCK_MODEL_ID');

export type FormHtmlInput = {
  formName: string;
  sourceFileName: string;
  sourceFileKey: string;
  mimeType: string;
  documentText: string;
  fields: DetectedFormField[];
  profile: CompanyProfileItem | null;
  knowledgeContext?: string;
};

// ─── Shared LLM call helper ───

const callLLM = async (system: string, user: string, maxTokens = 16000): Promise<string> => {
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    system,
    messages: [{ role: 'user', content: [{ type: 'text', text: user }] }],
    temperature: 0,
    max_tokens: maxTokens,
  };

  const responseBody = await invokeModel(getBedrockModelId(), JSON.stringify(body));
  const responseJson = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as Record<string, unknown>;
  const contentBlocks = (responseJson?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
  const rawText = contentBlocks.find((c) => c?.type === 'text')?.text ?? '';

  let html = rawText.trim();
  if (html.startsWith('```html')) html = html.slice(7);
  if (html.startsWith('```')) html = html.slice(3);
  if (html.endsWith('```')) html = html.slice(0, -3);
  return html.trim();
};

// ─── Phase 1: Convert to HTML (accurate structure) ───

const convertPdfToHtml = async (fileKey: string): Promise<string> => {
  const structure = await extractPdfStructure(fileKey);
  const structureJson = structureToJson(structure);

  const system =
    'You convert structured document data (extracted by AWS Textract) into semantic HTML. Output ONLY HTML.\n\n' +
    'INPUT FORMAT: JSON array of blocks with types: TITLE, SECTION_HEADER, TEXT, KEY_VALUE, TABLE, LIST.\n' +
    'TABLE blocks have a "rows" array of string arrays (each row is an array of cell values).\n\n' +
    'RULES:\n' +
    '- TITLE blocks → <p style="text-align: center;"><strong>text</strong></p>\n' +
    '- SECTION_HEADER blocks → <p><strong>text</strong></p>\n' +
    '- TEXT blocks → <p>text</p>. Merge consecutive TEXT blocks that form one paragraph into a single <p>.\n' +
    '- KEY_VALUE blocks → Split on first colon. Label is bold, value follows. If value is empty, show an underlined blank.\n' +
    '- TABLE blocks → <table> with <tr>/<td>. If the table is used for layout (e.g., form fields side by side, signature blocks), use style="border: none; border-color: transparent;" on every td. If it\'s a data grid, use borders.\n' +
    '- LIST blocks → <p style="padding-left: 40px;">text</p>\n' +
    '- Do not add any content not present in the source data.\n' +
    '- Do not use inline font-family, font-size, or margin styles — the editor handles those.\n' +
    '- Keep underlined blanks as: <span style="display: inline-block; min-width: 150px; border-bottom: 1px solid #000;">&nbsp;</span>';

  const html = await callLLM(system, `STRUCTURED DOCUMENT BLOCKS:\n${structureJson}`);
  if (html.length > 100) return html;

  return structure.map((b) => `<p>${escapeHtml(b.content)}</p>`).join('\n');
};

const convertXlsxToHtml = async (fileKey: string): Promise<string> => {
  const bucket = getDocumentsBucket();
  const s3Obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: fileKey }));
  const bytes = await s3Obj.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Could not read S3 object: ${fileKey}`);

  const workbook = XLSX.read(bytes, { type: 'array' });
  const sheets: string[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    // Trim to actual data range
    const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1');
    let lastRow = 0;
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') {
          lastRow = r;
        }
      }
    }
    sheet['!ref'] = XLSX.utils.encode_range({ s: range.s, e: { r: lastRow, c: range.e.c } });

    const html = XLSX.utils.sheet_to_html(sheet, { id: `sheet-${sheetName}` });
    const bodyMatch = html.match(/<body>([\s\S]*)<\/body>/);
    let tableHtml = bodyMatch ? bodyMatch[1] : html;

    // Clean up: remove data attributes, add proper table styling
    tableHtml = tableHtml
      .replace(/<table[^>]*>/g, '<table style="border-collapse: collapse; width: 100%; font-size: 13px;">')
      .replace(/<td/g, '<td style="border: 1px solid #d1d5db; padding: 6px 8px; vertical-align: top;"')
      .replace(/<th/g, '<th style="border: 1px solid #d1d5db; padding: 6px 8px; vertical-align: top; font-weight: bold; background: #f1f5f9;"')
      .replace(/ data-[a-z-]+="[^"]*"/g, '')
      .replace(/ id="[^"]*"/g, '')
      .replace(/ xml:space="[^"]*"/g, '')
      // Remove [INSERT LOGO] placeholder
      .replace(/\[INSERT LOGO\]/g, '');

    sheets.push(tableHtml);
  }

  return sheets.join('\n');
};

// ─── PDF conversion: send actual PDF to Claude (multimodal) ───

const convertPdfWithVision = async (fileKey: string): Promise<string> => {
  const bucket = getDocumentsBucket();
  const s3Obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: fileKey }));
  const bytes = await s3Obj.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Could not read PDF from S3: ${fileKey}`);

  const base64 = Buffer.from(bytes).toString('base64');

  const system =
    'You convert a PDF document into semantic HTML that faithfully reproduces the original layout. Output ONLY HTML — no markdown, no commentary.\n\n' +
    'LAYOUT RULES (match the original PDF exactly):\n' +
    '- Reproduce exact positioning: if title is left-aligned bold, keep it left-aligned bold. If centered, center it.\n' +
    '- "EXEMPTION CERTIFICATE" and "(CONSTRUCTION CONTRACT)" on separate lines = separate <p> tags, same alignment as original.\n' +
    '- Form fields with underline blanks above labels (like "_____ Name of Project"): use a layout table with border: none; border-color: transparent on every td.\n' +
    '  Row 1: underline blank. Row 2: label text. This preserves the "blank above, label below" pattern.\n' +
    '- Bold/italic text: use <strong> and <em> exactly as in the original.\n' +
    '- Checkbox items with hanging indent: <p style="padding-left: 60px; text-indent: -30px;">(X) text...</p>\n' +
    '- Signature blocks (two columns side by side): <table> with border: none; border-color: transparent on every td.\n' +
    '- Underlined blanks: <span style="display: inline-block; min-width: 200px; border-bottom: 1px solid #000;">&nbsp;</span>\n' +
    '- Do NOT use inline font-family, font-size, line-height, or margin styles — the editor provides those.\n' +
    '- Do NOT add any content not in the original document.\n';

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    system,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: base64 },
        },
        {
          type: 'text',
          text: 'Convert this PDF to HTML. Reproduce the exact visual layout.',
        },
      ],
    }],
    temperature: 0,
    max_tokens: 16000,
  };

  const responseBody = await invokeModel(getBedrockModelId(), JSON.stringify(body));
  const responseJson = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as Record<string, unknown>;
  const contentBlocks = (responseJson?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
  const rawText = contentBlocks.find((c) => c?.type === 'text')?.text ?? '';

  let html = rawText.trim();
  if (html.startsWith('```html')) html = html.slice(7);
  if (html.startsWith('```')) html = html.slice(3);
  if (html.endsWith('```')) html = html.slice(0, -3);
  return html.trim();
};

// ─── Fallback: LLM text-only conversion ───

const convertWithLLM = async (documentText: string): Promise<string> => {
  const system =
    'You convert extracted document text into semantic HTML. Output ONLY HTML — no markdown, no commentary.\n\n' +
    'LAYOUT RULES:\n' +
    '- Reproduce the original document layout as faithfully as possible.\n' +
    '- Bold/italic text: use <strong> and <em>\n' +
    '- Checkboxes with indent: <p style="padding-left: 60px; text-indent: -30px;">(X) text</p>\n' +
    '- Layout tables (fields side by side): border: none; border-color: transparent on every td/th\n' +
    '- Underlined blanks: <span style="display: inline-block; min-width: 200px; border-bottom: 1px solid #000;">&nbsp;</span>\n' +
    '- Do NOT use inline font-family, font-size, or margin styles.\n';

  try {
    const html = await callLLM(system, `DOCUMENT TEXT:\n${documentText.slice(0, 100_000)}`);
    if (html.length > 100) return html;
  } catch (err) {
    console.warn('LLM text conversion failed:', (err as Error)?.message);
  }

  return fallbackFromText(documentText);
};

// ─── Phase 2: Fill blanks with data (LLM fill-only) ───

const FILL_SYSTEM =
  'You fill blank fields in an HTML document with provided company data. Output ONLY the modified HTML — no markdown, no commentary.\n\n' +
  'RULES (follow exactly):\n' +
  '- Find empty cells, blank underlines, and placeholder text. Fill them with matching data.\n' +
  '- Auto-filled values: wrap in <span style="background-color: #dcfce7; padding: 2px 6px; border-radius: 3px; border-bottom: 2px solid #22c55e;">value</span>\n' +
  '- Fields needing human input (no data found): replace blank with <span style="color: #9ca3af; border-bottom: 1px solid #9ca3af; padding-bottom: 1px;">field label</span>\n' +
  '  Use just the field name as gray underlined text. Do NOT show the label twice.\n' +
  '- For _________ underlines with labels like (Signature) or (Date) underneath:\n' +
  '  Replace BOTH the underlines and the parenthesized label with a single gray span.\n' +
  '- For compliance tables (Fully Meets / Partially Meets / Cannot Meet):\n' +
  '  Use knowledge context to mark "X" where the company clearly has the capability.\n' +
  '  Fill "Additional Information" columns with brief capability descriptions from KB.\n' +
  '  Leave empty if no relevant KB data exists.\n' +
  '- Do NOT change the HTML structure, layout, or existing styles.\n' +
  '- Do NOT add titles, headers, or wrapper elements.\n' +
  '- Tables with style="border: none" or style="border-color: transparent" on cells: do NOT add borders.\n';

const fillFormHtml = async (html: string, input: FormHtmlInput): Promise<string> => {
  const profileSummary = buildProfileSummary(input.profile);

  const user =
    `COMPANY PROFILE:\n${profileSummary}\n\n` +
    (input.knowledgeContext ? `KNOWLEDGE CONTEXT (capabilities, past performance):\n${input.knowledgeContext.slice(0, 40_000)}\n\n` : '') +
    `HTML TO FILL:\n${html.slice(0, 80_000)}`;

  try {
    const filled = await callLLM(FILL_SYSTEM, user);
    if (filled.length > 100) return filled;
  } catch (err) {
    console.warn('LLM fill pass failed, returning unfilled HTML:', (err as Error)?.message);
  }

  return html;
};

// ─── Main Entry Point ───

export const generateFormHtml = async (input: FormHtmlInput): Promise<string> => {
  const { sourceFileKey, mimeType } = input;

  const isXlsx = mimeType.includes('spreadsheet') || mimeType.includes('excel') ||
    sourceFileKey.toLowerCase().endsWith('.xlsx') || sourceFileKey.toLowerCase().endsWith('.xls');
  const isPdf = mimeType.includes('pdf') || sourceFileKey.toLowerCase().endsWith('.pdf');

  // Phase 1: Convert to accurate HTML
  let rawHtml: string;
  try {
    if (isPdf) {
      // Send actual PDF to Claude vision for faithful HTML reproduction
      rawHtml = await convertPdfWithVision(sourceFileKey);
      if (!rawHtml || rawHtml.length < 100) {
        console.warn('PDF vision conversion returned insufficient HTML, trying Textract');
        rawHtml = await convertPdfToHtml(sourceFileKey);
      }
    } else if (isXlsx) {
      rawHtml = await convertXlsxToHtml(sourceFileKey);
    } else {
      rawHtml = fallbackFromText(input.documentText);
    }
  } catch (err) {
    console.warn(`HTML conversion failed for ${sourceFileKey}, using LLM text fallback:`, (err as Error)?.message);
    rawHtml = await convertWithLLM(input.documentText);
  }

  // Phase 2: Fill blanks with company data
  const filledHtml = await fillFormHtml(rawHtml, input);

  return filledHtml;
};

// Re-fill an existing form's HTML with updated profile data
export const refillFormHtml = async (existingHtml: string, profile: CompanyProfileItem | null, knowledgeContext?: string): Promise<string> => {
  // Strip existing auto-fill spans (green highlights) to re-fill from scratch
  const cleanedHtml = existingHtml
    .replace(/<span style="background-color: #dcfce7[^"]*">[^<]*<\/span>/g, (match) => {
      // Extract the text content and replace with empty underline
      return '<span style="display: inline-block; min-width: 150px; border-bottom: 1px solid #000;">&nbsp;</span>';
    });

  return fillFormHtml(cleanedHtml, {
    formName: '',
    sourceFileName: '',
    sourceFileKey: '',
    mimeType: '',
    documentText: '',
    fields: [],
    profile,
    knowledgeContext,
  });
};

// ─── Helpers ───

const escapeHtml = (str: string): string =>
  str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const buildProfileSummary = (profile: CompanyProfileItem | null): string => {
  if (!profile) return 'No company profile available.';
  const entries: string[] = [];
  if (profile.companyName) entries.push(`Company Name: ${profile.companyName}`);
  if (profile.legalEntityName) entries.push(`Legal Entity Name: ${profile.legalEntityName}`);
  if (profile.dba) entries.push(`DBA: ${profile.dba}`);
  if (profile.address) entries.push(`Address: ${profile.address}`);
  if (profile.city) entries.push(`City: ${profile.city}`);
  if (profile.state) entries.push(`State: ${profile.state}`);
  if (profile.zip) entries.push(`Zip: ${profile.zip}`);
  if (profile.phone) entries.push(`Phone: ${profile.phone}`);
  if (profile.email) entries.push(`Email: ${profile.email}`);
  if (profile.website) entries.push(`Website: ${profile.website}`);
  if (profile.ein) entries.push(`EIN: ${profile.ein}`);
  if (profile.uei) entries.push(`UEI: ${profile.uei}`);
  if (profile.cage) entries.push(`CAGE Code: ${profile.cage}`);
  if (profile.primaryNaics) entries.push(`Primary NAICS: ${profile.primaryNaics}`);
  if (profile.entityType) entries.push(`Entity Type: ${profile.entityType}`);
  if (profile.stateEntityNumber) entries.push(`State Entity No: ${profile.stateEntityNumber}`);
  if (profile.smallBusinessCertId) entries.push(`SB Cert ID: ${profile.smallBusinessCertId}`);
  if (profile.smallBusinessCertExpiration) entries.push(`SB Cert Expiration: ${profile.smallBusinessCertExpiration}`);
  if (profile.authorizedSignatory) {
    entries.push(`Authorized Signatory: ${profile.authorizedSignatory.name}, ${profile.authorizedSignatory.title}`);
  }
  for (const field of profile.fields ?? []) {
    entries.push(`${field.label}: ${field.value}`);
  }
  return entries.join('\n');
};

const fallbackFromText = (text: string): string => {
  return text.split('\n').filter((l) => l.trim()).slice(0, 200)
    .map((l) => `<p>${escapeHtml(l)}</p>`).join('\n');
};
