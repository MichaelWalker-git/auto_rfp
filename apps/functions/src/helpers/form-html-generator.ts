import { invokeModel } from './bedrock-http-client';
import { requireEnv } from './env';

import type { DetectedFormField, CompanyProfileItem } from '@auto-rfp/core';

const getBedrockModelId = () => requireEnv('BEDROCK_MODEL_ID');

type FormHtmlInput = {
  formName: string;
  sourceFileName: string;
  sourceFileKey: string;
  mimeType: string;
  documentText: string;
  fields: DetectedFormField[];
  profile: CompanyProfileItem | null;
  knowledgeContext?: string;
};

const FILL_RULES =
  'FIELD STYLING (CRITICAL — follow exactly):\n' +
  '- AI-filled value (confident): <span style="background-color: #dcfce7; padding: 2px 6px; border-radius: 3px; border-bottom: 2px solid #22c55e;">filled value</span>\n' +
  '- Needs human input (blank field): <span style="color: #9ca3af; border-bottom: 1px solid #9ca3af; padding-bottom: 1px;">field label</span>\n' +
  '  Show ONLY the gray underlined placeholder. Do NOT also show the label as regular text next to it.\n' +
  '  WRONG: "Name of Project <span>Name of Project</span>" ← the label appears twice!\n' +
  '  CORRECT: just <span style="color: #9ca3af; border-bottom: 1px solid #9ca3af; padding-bottom: 1px;">Name of Project</span>\n' +
  '- For underscored blanks (_______ with parenthesized label "(Signature)" underneath):\n' +
  '  Replace EVERYTHING (underscores + label text) with a SINGLE gray underlined span.\n' +
  '- For labeled blanks like "Name of Project ___________": replace the WHOLE thing (label + underscores) with just the gray span.\n' +
  '  The gray text IS the label. Do not repeat it.\n' +
  '- TABLES (CRITICAL — border handling):\n' +
  '  The rich text editor adds visible borders to ALL table cells by default.\n' +
  '  If the original document has NO visible borders on a table (layout tables, signature blocks, field grids):\n' +
  '    → Every <table> MUST have style="border-collapse: collapse; width: 100%; border: none;"\n' +
  '    → Every <td> and <th> MUST have style="border: none; border-color: transparent;" explicitly\n' +
  '    → Without this, the editor will show ugly grid lines that do not exist in the original.\n' +
  '  If the original document HAS visible grid borders (data tables, matrices): use border: 1px solid #d1d5db.\n';

const callLLM = async (systemPrompt: string, userPrompt: string): Promise<string> => {
  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    system: systemPrompt,
    messages: [{ role: 'user', content: [{ type: 'text', text: userPrompt }] }],
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

// ─── XLSX → HTML ───

const generateXlsxHtml = async (input: FormHtmlInput): Promise<string> => {
  const system =
    'You convert extracted spreadsheet text into an HTML table AND fill fields with provided data. Output ONLY HTML — no markdown, no commentary.\n\n' +
    'TABLE LAYOUT:\n' +
    '- Use <table> with <thead>/<tbody>, <th> for header row, <td> for data\n' +
    '- Header row: bold, background #f1f5f9\n' +
    '- Category/section rows spanning all columns: bold, background #dbeafe, use colspan\n' +
    '- NO empty rows. Only rows that have data in at least one cell.\n' +
    '- If the original spreadsheet has no visible grid borders, use border: none on cells. If it has a grid, use 1px solid #d1d5db.\n' +
    '- Do NOT add any title or heading before the table.\n\n' +
    FILL_RULES +
    '\nINSTRUCTIONS WITHIN THE DOCUMENT:\n' +
    '- If the spreadsheet contains instructions (like "Please identify for each feature the ability to Fully Meet, Partially Meet or Cannot Meet"), FOLLOW those instructions.\n' +
    '- Use the knowledge context to determine compliance. If the company clearly has a capability → mark "X" in Fully Meets. If partial → "X" in Partially Meets with a comment explaining the limitation.\n' +
    '- Fill "Additional Information / Comments" columns with brief, specific capability descriptions from the knowledge context.\n' +
    '- If no relevant KB information exists for a feature, leave cells empty (no placeholder spans, no "TO BE COMPLETED" text).\n\n' +
    'DATA FILL:\n' +
    '- Use company profile to fill identity fields (company name, respondent name, address, etc.)\n' +
    '- Use knowledge context to fill capability/technical fields with real information.\n';

  const user =
    `COMPANY PROFILE:\n${buildProfileSummary(input.profile)}\n\n` +
    (input.knowledgeContext ? `KNOWLEDGE CONTEXT (company capabilities, past performance):\n${input.knowledgeContext.slice(0, 40_000)}\n\n` : '') +
    `SPREADSHEET TEXT:\n${input.documentText.slice(0, 80_000)}`;

  try {
    const html = await callLLM(system, user);
    if (html.length > 100) return html;
  } catch (err) {
    console.warn('XLSX→HTML failed:', (err as Error)?.message);
  }

  return fallbackFromText(input.documentText);
};

// ─── PDF → HTML ───

const generatePdfHtml = async (input: FormHtmlInput): Promise<string> => {
  const system =
    'You convert extracted PDF document text into faithful HTML AND fill form fields with provided data. Output ONLY HTML — no markdown, no commentary.\n\n' +
    'LAYOUT (CRITICAL — reproduce the original printed document faithfully):\n' +
    '- Title/heading lines that are centered in the original: <p style="text-align: center;"><strong>TEXT</strong></p>\n' +
    '- Lines that form one paragraph: merge into ONE <p> tag.\n' +
    '- Bold text: <strong>text</strong>\n' +
    '- Indented checkbox items: use padding-left on the <p>, render (X) or ( ) inline\n' +
    '- Do NOT use inline font-family, font-size, line-height, or margin styles.\n' +
    '- Do NOT split a sentence across multiple <p> tags.\n' +
    '- Do NOT add any title/header that was not in the original.\n\n' +
    'TABLES IN PDF FORMS (important):\n' +
    '- Many PDF forms use tables for layout — fields side by side, signature blocks, etc.\n' +
    '- These layout tables have NO visible borders in the original. Use: <table style="border-collapse: collapse; width: 100%;"> and <td style="border: none; padding: 4px 8px; vertical-align: top;">\n' +
    '- Example: "Name of Project ___" next to "Contract No. ___" = a table row with two cells, each containing label + field.\n' +
    '- The signature block at the bottom (two columns: contractor and contractee) = a table with border: none.\n' +
    '- EVERY td and th must have style="border: none" explicitly or the editor will add visible borders.\n\n' +
    'INSTRUCTIONS WITHIN THE DOCUMENT:\n' +
    '- If the document contains instructions (like "Please identify for each feature the ability to Fully Meet..."), follow those instructions when filling.\n' +
    '- If it says to identify compliance, and you have knowledge context about the company capabilities, mark the appropriate response.\n\n' +
    FILL_RULES +
    '\nDATA FILL:\n' +
    '- Fill blanks/underlines from company profile where the label matches.\n' +
    '- Use knowledge context for capability/technical fields.\n' +
    '- Agency info (City of Toledo, their address): leave as-is, do not fill or highlight.\n';

  const user =
    `COMPANY PROFILE:\n${buildProfileSummary(input.profile)}\n\n` +
    (input.knowledgeContext ? `KNOWLEDGE CONTEXT:\n${input.knowledgeContext.slice(0, 40_000)}\n\n` : '') +
    `DOCUMENT TEXT:\n${input.documentText.slice(0, 80_000)}`;

  try {
    const html = await callLLM(system, user);
    if (html.length > 100) return html;
  } catch (err) {
    console.warn('PDF→HTML failed:', (err as Error)?.message);
  }

  return fallbackFromText(input.documentText);
};

// ─── Main Entry Point ───

export const generateFormHtml = async (input: FormHtmlInput): Promise<string> => {
  const { sourceFileKey, mimeType } = input;

  const isXlsx = mimeType.includes('spreadsheet') || mimeType.includes('excel') ||
    sourceFileKey.toLowerCase().endsWith('.xlsx') || sourceFileKey.toLowerCase().endsWith('.xls');
  const isPdf = mimeType.includes('pdf') || sourceFileKey.toLowerCase().endsWith('.pdf');

  try {
    if (isXlsx) return await generateXlsxHtml(input);
    if (isPdf) return await generatePdfHtml(input);
    return fallbackFromText(input.documentText);
  } catch (err) {
    console.warn(`HTML conversion failed for ${sourceFileKey}:`, (err as Error)?.message);
    return fallbackFromText(input.documentText);
  }
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
    .map((l) => `<p style="margin: 0 0 2px;">${escapeHtml(l)}</p>`).join('\n');
};
