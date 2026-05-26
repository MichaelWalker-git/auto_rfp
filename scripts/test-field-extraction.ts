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
    '- Empty date fields\n\n' +
    'DO NOT extract:\n' +
    '- Fields that already have text/values filled in\n' +
    '- Pre-printed static text, headings, or labels\n' +
    '- Fields belonging to the contracting agency that are already completed\n\n' +
    'For each field return:\n' +
    '- label: descriptive name\n' +
    '- fieldType: "text" | "signature" | "date" | "checkbox" | "address" | "number"\n' +
    '- currentValue: null\n' +
    '- pageNumber: which page (1-indexed)\n' +
    '- boundingBox: { top, left, width, height } — normalized 0.0 to 1.0 relative to page dimensions\n\n' +
    'BOUNDING BOX POSITIONING (very important):\n' +
    'Imagine you are placing a transparent text input widget ON TOP of the document.\n' +
    'The widget must sit exactly on the BLANK SPACE where someone would handwrite their answer.\n\n' +
    'Pattern A — Underline with label below:\n' +
    '  Visual: ________________________\n' +
    '          (Corporation Name)\n' +
    '  The widget goes ON the underline, NOT on the "(Corporation Name)" text.\n' +
    '  The underline is ABOVE the label by about 0.025 in normalized coords.\n\n' +
    'Pattern B — Inline blank after text:\n' +
    '  Visual: "municipality and _______________________"\n' +
    '  The widget covers only the blank underlined portion after "and".\n\n' +
    'Key rules:\n' +
    '- top = vertical position of the UNDERLINE itself (the blank writing area)\n' +
    '- The "(Label)" text below is NOT the field position — subtract ~0.025-0.03 from label position\n' +
    '- height = 0.020 (one line height)\n' +
    '- left = where the underline starts horizontally\n' +
    '- width = full extent of the underline\n\n' +
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
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outFile = `/tmp/field-extraction-${timestamp}.json`;
  writeFileSync(outFile, JSON.stringify({ fields, rawText, prompt: system, elapsed, input }, null, 2));
  console.log(`\nJSON saved to: ${outFile}`);

  // Generate HTML preview with PDF + field overlays
  const htmlFile = `/tmp/field-extraction-${timestamp}.html`;
  const pdfDataUrl = `data:application/pdf;base64,${base64}`;

  const fieldOverlays = (fields as Array<{ label: string; fieldType: string; pageNumber: number; boundingBox: { top: number; left: number; width: number; height: number } }>)
    .map((f, i) => {
      const bb = f.boundingBox;
      if (!bb) return '';
      const color = f.fieldType === 'signature' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(99, 102, 241, 0.25)';
      const border = f.fieldType === 'signature' ? '1px dashed #ef4444' : '1px solid #6366f1';
      return `<div class="field" style="top:${bb.top*100}%;left:${bb.left*100}%;width:${bb.width*100}%;height:${bb.height*100}%;background:${color};border:${border};" title="${f.label} (${f.fieldType}) page ${f.pageNumber}"><span class="label">${i+1}. ${f.label}</span></div>`;
    }).join('\n');

  // Group fields by page
  const fieldsByPage: Record<number, typeof fields> = {};
  for (const f of fields as Array<{ label: string; fieldType: string; pageNumber: number; boundingBox: { top: number; left: number; width: number; height: number } }>) {
    const page = f.pageNumber ?? 1;
    if (!fieldsByPage[page]) fieldsByPage[page] = [];
    fieldsByPage[page].push(f);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Field Extraction: ${input} — ${timestamp}</title>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs" type="module"></script>
<style>
  body { margin: 0; font-family: system-ui; background: #1e1e2e; color: #cdd6f4; }
  .header { padding: 10px 20px; background: #313244; border-bottom: 1px solid #45475a; display: flex; align-items: center; gap: 16px; }
  .header h1 { font-size: 14px; margin: 0; color: #cdd6f4; }
  .header .meta { font-size: 11px; color: #a6adc8; }
  .container { display: flex; gap: 16px; padding: 16px; height: calc(100vh - 50px); }
  .pdf-panel { flex: 1; overflow-y: auto; display: flex; flex-direction: column; align-items: center; gap: 16px; padding: 16px; }
  .fields-panel { width: 300px; background: #313244; border-radius: 8px; overflow-y: auto; }
  .fields-panel h2 { padding: 10px 14px; margin: 0; font-size: 12px; border-bottom: 1px solid #45475a; position: sticky; top: 0; background: #313244; color: #cdd6f4; }
  .field-item { padding: 6px 14px; border-bottom: 1px solid #45475a; font-size: 10px; cursor: pointer; }
  .field-item:hover { background: #45475a; }
  .field-item .name { font-weight: 600; color: #cdd6f4; }
  .field-item .coords { color: #a6adc8; margin-top: 2px; }
  .page-wrap { position: relative; background: white; box-shadow: 0 4px 20px rgba(0,0,0,0.4); }
  .page-wrap canvas { display: block; }
  .field-overlay { position: absolute; border: 1.5px solid #6366f1; background: rgba(99, 102, 241, 0.15); border-radius: 2px; display: flex; align-items: center; overflow: hidden; }
  .field-overlay.signature { border-color: #ef4444; background: rgba(239, 68, 68, 0.12); }
  .field-overlay .tag { font-size: 7px; color: #4338ca; padding: 0 3px; font-weight: 600; white-space: nowrap; }
  .field-overlay.signature .tag { color: #dc2626; }
</style>
</head>
<body>
<div class="header">
  <h1>Field Extraction Preview</h1>
  <span class="meta">${input} &middot; ${fields.length} fields &middot; ${elapsed}s &middot; ${timestamp}</span>
</div>
<div class="container">
  <div class="pdf-panel" id="pdf-pages"></div>
  <div class="fields-panel">
    <h2>${fields.length} Fields</h2>
    ${(fields as Array<{ label: string; fieldType: string; pageNumber: number; boundingBox: { top: number; left: number; width: number; height: number } }>).map((f, i) => {
      const bb = f.boundingBox;
      return `<div class="field-item" onclick="scrollToField(${f.pageNumber}, ${bb?.top})"><div class="name">${i+1}. ${f.label}</div><div class="coords">${f.fieldType} · p${f.pageNumber} · top=${bb?.top?.toFixed(3)} left=${bb?.left?.toFixed(3)} w=${bb?.width?.toFixed(3)}</div></div>`;
    }).join('\n')}
  </div>
</div>
<script type="module">
import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.9.155/pdf.worker.min.mjs';

const fieldsByPage = ${JSON.stringify(fieldsByPage)};
const container = document.getElementById('pdf-pages');

const pdf = await pdfjsLib.getDocument({data: Uint8Array.from(atob('${base64}').split('').map(c=>c.charCodeAt(0)))}).promise;

for (let i = 1; i <= pdf.numPages; i++) {
  const page = await pdf.getPage(i);
  const viewport = page.getViewport({scale: 1.5});

  const wrap = document.createElement('div');
  wrap.className = 'page-wrap';
  wrap.style.width = viewport.width + 'px';
  wrap.style.height = viewport.height + 'px';
  wrap.id = 'page-' + i;

  const canvas = document.createElement('canvas');
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  await page.render({canvasContext: canvas.getContext('2d'), viewport}).promise;
  wrap.appendChild(canvas);

  // Add field overlays for this page
  const pageFields = fieldsByPage[i] || [];
  for (const f of pageFields) {
    const bb = f.boundingBox;
    if (!bb) continue;
    const div = document.createElement('div');
    div.className = 'field-overlay' + (f.fieldType === 'signature' ? ' signature' : '');
    div.style.left = (bb.left * 100) + '%';
    div.style.top = (bb.top * 100) + '%';
    div.style.width = (bb.width * 100) + '%';
    div.style.height = (bb.height * 100) + '%';
    div.innerHTML = '<span class="tag">' + f.label + '</span>';
    div.title = f.label + ' (' + f.fieldType + ')';
    wrap.appendChild(div);
  }

  container.appendChild(wrap);
}

window.scrollToField = (page, top) => {
  const el = document.getElementById('page-' + page);
  if (el) el.scrollIntoView({behavior: 'smooth', block: 'center'});
};
</script>
</body>
</html>`;

  writeFileSync(htmlFile, html);
  console.log(`HTML preview: ${htmlFile}`);
  console.log(`Open: open ${htmlFile}`);

  // Save the prompt for easy editing
  const promptFile = '/tmp/field-extraction-prompt.txt';
  writeFileSync(promptFile, system);
  console.log(`Prompt: ${promptFile}`);
  console.log('\nTo iterate: edit prompt → re-run → compare HTML files by timestamp.');
};

run().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
