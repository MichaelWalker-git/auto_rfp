/**
 * Local test script for form field extraction via Claude vision.
 * Downloads a PDF from S3, sends to Claude, and outputs detected fields.
 *
 * Usage:
 *   npx tsx scripts/test-field-extraction.ts <s3-file-key>
 *   npx tsx scripts/test-field-extraction.ts <local-file-path>
 *
 * Environment vars needed:
 *   DOCUMENTS_BUCKET=auto-rfp-documents-dev-039885961427
 *   BEDROCK_MODEL_ID=us.anthropic.claude-opus-4-6-v1
 *   BEDROCK_REGION=us-east-1
 *   BEDROCK_API_KEY_SSM_PARAM=/auto-rfp/bedrock/api-key
 *
 * Example:
 *   export DOCUMENTS_BUCKET=auto-rfp-documents-dev-039885961427
 *   npx tsx scripts/test-field-extraction.ts "./20260501094233305 Professional Services Contract.pdf"
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const run = async () => {
  const input = process.argv[2];
  if (!input) {
    console.log('Usage: npx tsx scripts/test-field-extraction.ts <s3-key-or-local-path>');
    process.exit(0);
  }

  let pdfBytes: Buffer;

  if (existsSync(input)) {
    // Local file
    console.log(`Reading local file: ${input}`);
    pdfBytes = readFileSync(input);
  } else {
    // S3 key
    const bucket = process.env.DOCUMENTS_BUCKET;
    if (!bucket) {
      console.error('Set DOCUMENTS_BUCKET env var');
      process.exit(1);
    }
    console.log(`Downloading from S3: ${bucket}/${input}`);
    const s3 = new S3Client({});
    const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: input }));
    const bytes = await obj.Body?.transformToByteArray();
    if (!bytes) { console.error('Empty S3 object'); process.exit(1); }
    pdfBytes = Buffer.from(bytes);
  }

  console.log(`PDF size: ${(pdfBytes.length / 1024).toFixed(1)} KB`);

  // Import the extraction function
  // We need to set env vars before importing
  process.env.DOCUMENTS_BUCKET = process.env.DOCUMENTS_BUCKET || 'test-bucket';
  process.env.BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-opus-4-6-v1';
  process.env.BEDROCK_REGION = process.env.BEDROCK_REGION || 'us-east-1';
  process.env.BEDROCK_API_KEY_SSM_PARAM = process.env.BEDROCK_API_KEY_SSM_PARAM || '/auto-rfp/bedrock/api-key';
  process.env.DB_TABLE_NAME = process.env.DB_TABLE_NAME || 'RFP-table-Dev';
  process.env.REGION = process.env.REGION || 'us-east-1';

  // Direct Bedrock call (avoids path alias issues from running outside functions workspace)
  const { SSMClient, GetParameterCommand } = await import('@aws-sdk/client-ssm');
  const https = await import('https');

  const ssmParam = process.env.BEDROCK_API_KEY_SSM_PARAM || '/auto-rfp/bedrock/api-key';
  const region = process.env.BEDROCK_REGION || 'us-east-1';
  const ssm = new SSMClient({ region });
  const paramRes = await ssm.send(new GetParameterCommand({ Name: ssmParam, WithDecryption: true }));
  const apiKey = paramRes.Parameter?.Value;
  if (!apiKey) { console.error('Could not get Bedrock API key from SSM'); process.exit(1); }

  const invokeModel = (modelId: string, body: string): Promise<Uint8Array> => {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: `bedrock-runtime.${region}.amazonaws.com`,
        path: `/model/${encodeURIComponent(modelId)}/invoke`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      };
      const req = https.request(options, (res: any) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
      });
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  };

  const safeParseJsonFromModel = (text: string): unknown => {
    try {
      const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      return JSON.parse(cleaned);
    } catch { return null; }
  };

  const base64 = pdfBytes.toString('base64');
  const modelId = process.env.BEDROCK_MODEL_ID!;

  // Same prompt as extract-form-fields-vision.ts
  const system =
    'You extract UNFILLED form fields from documents. Return ONLY valid JSON — no markdown, no commentary.\n\n' +
    'Find ONLY places that are BLANK and need to be filled in by a human:\n' +
    '- Underscored blank lines (______) with no text written on them\n' +
    '- Labeled blanks where the value area is empty (Company Name: ______)\n' +
    '- Empty cells in tables that need data entered\n' +
    '- Blank signature lines (no signature present)\n' +
    '- Empty date fields\n' +
    '- Unchecked checkboxes\n\n' +
    'DO NOT extract:\n' +
    '- Fields that already have text/values filled in (e.g. "City of Toledo" already written)\n' +
    '- Pre-printed static text, headings, or labels\n' +
    '- Checked checkboxes\n' +
    '- Fields belonging to the contracting agency that are already completed\n\n' +
    'For each BLANK field return:\n' +
    '- label: descriptive name (e.g. "Company Name", "Signature", "Date", "Contract No.")\n' +
    '- fieldType: "text" | "signature" | "date" | "checkbox" | "address" | "number"\n' +
    '- currentValue: null (these are all blank fields)\n' +
    '- pageNumber: which page (1-indexed)\n' +
    '- boundingBox: { top, left, width, height } as normalized coordinates (0.0 to 1.0 relative to page)\n\n' +
    'BOUNDING BOX RULES (CRITICAL):\n' +
    '- The boundingBox covers WHERE THE USER TYPES — the blank horizontal line, not any printed text.\n' +
    '- top: the Y coordinate where the HORIZONTAL UNDERLINE is drawn on the page.\n' +
    '  If there is a label "(Corporation Name)" at Y=0.15, the underline above it is at approximately Y=0.12.\n' +
    '  Return top=0.12, NOT top=0.15.\n' +
    '- The bbox should be 0.02-0.03 ABOVE any parenthesized label text like "(Signature)" or "(Date)".\n' +
    '- height: 0.020 (thin line area)\n' +
    '- left/width: match the extent of the underline.\n' +
    '- If text like "municipality (\\"Toledo\\") and ___________" has an inline blank, the bbox covers just the underline portion.\n\n' +
    'Return JSON: { "fields": [...] }';

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    system,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: 'Extract all fillable form fields from this document. Return their labels, types, and exact positions as normalized bounding box coordinates (0-1).' },
      ],
    }],
    temperature: 0,
    max_tokens: 8000,
  };

  console.log(`\nCalling Claude (${modelId})...`);
  const start = Date.now();

  const responseBody = await invokeModel(modelId, JSON.stringify(body));
  const responseJson = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as Record<string, unknown>;
  const contentBlocks = (responseJson?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
  const rawText = contentBlocks.find((c) => c?.type === 'text')?.text ?? '';

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Response received in ${elapsed}s (${rawText.length} chars)\n`);

  const parsed = safeParseJsonFromModel(rawText) as Record<string, unknown> | null;
  const fields = Array.isArray(parsed?.fields) ? parsed.fields : [];

  console.log(`Detected ${fields.length} fields:\n`);
  console.log('┌─────────────────────────────────────┬──────────┬────────┬───────┬───────┬───────┐');
  console.log('│ Label                               │ Type     │ Page   │ Top   │ Left  │ Width │');
  console.log('├─────────────────────────────────────┼──────────┼────────┼───────┼───────┼───────┤');

  for (const f of fields as Array<{ label: string; fieldType: string; pageNumber: number; boundingBox: { top: number; left: number; width: number; height: number } }>) {
    const label = (f.label ?? '?').slice(0, 35).padEnd(35);
    const type = (f.fieldType ?? '?').slice(0, 8).padEnd(8);
    const page = String(f.pageNumber ?? '?').padEnd(6);
    const top = (f.boundingBox?.top?.toFixed(3) ?? '?').padEnd(5);
    const left = (f.boundingBox?.left?.toFixed(3) ?? '?').padEnd(5);
    const width = (f.boundingBox?.width?.toFixed(3) ?? '?').padEnd(5);
    console.log(`│ ${label} │ ${type} │ ${page} │ ${top} │ ${left} │ ${width} │`);
  }
  console.log('└─────────────────────────────────────┴──────────┴────────┴───────┴───────┴───────┘');

  // Save raw response for debugging
  const outFile = '/tmp/field-extraction-result.json';
  writeFileSync(outFile, JSON.stringify({ fields, rawText }, null, 2));
  console.log(`\nFull response saved to: ${outFile}`);

  // Save the prompt for easy editing
  const promptFile = '/tmp/field-extraction-prompt.txt';
  writeFileSync(promptFile, system);
  console.log(`Prompt saved to: ${promptFile}`);
  console.log('\nTo iterate on the prompt, edit the prompt file and re-run.');
};

run().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
