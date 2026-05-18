import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

import { invokeModel } from './bedrock-http-client';
import { safeParseJsonFromModel } from './json';
import { requireEnv } from './env';

import type { DetectedFormField } from '@auto-rfp/core';

const s3 = new S3Client({});
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');
const getBedrockModelId = () => requireEnv('BEDROCK_MODEL_ID');

type VisionField = {
  label: string;
  fieldType: 'text' | 'signature' | 'date' | 'checkbox' | 'address' | 'number';
  currentValue: string | null;
  pageNumber: number;
  boundingBox: { top: number; left: number; width: number; height: number };
};

export const extractFormFieldsWithVision = async (fileKey: string): Promise<DetectedFormField[]> => {
  const bucket = getDocumentsBucket();
  const s3Obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: fileKey }));
  const bytes = await s3Obj.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Could not read file from S3: ${fileKey}`);

  const base64 = Buffer.from(bytes).toString('base64');
  const isPdf = fileKey.toLowerCase().endsWith('.pdf');
  const mediaType = isPdf ? 'application/pdf' : 'image/png';

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
    'BOUNDING BOX RULES (CRITICAL — read carefully):\n' +
    '- The boundingBox must cover the UNDERLINE/BLANK LINE where someone would write — NOT the parenthesized label below it.\n' +
    '- Common pattern: a blank line ______ with "(Corporation Name)" printed below it.\n' +
    '  The boundingBox goes on the BLANK LINE ABOVE, not on the "(Corporation Name)" text.\n' +
    '- top: position of the UNDERLINE (the horizontal line), NOT the label text below it.\n' +
    '- The label like "(Signature)" or "(Date)" is just a hint about what goes on the line above.\n' +
    '- height: approximately 0.02-0.025 (one text line height)\n' +
    '- left: where the underline starts (often at a margin ~0.05-0.10)\n' +
    '- width: how wide the underline extends\n' +
    '- WRONG: placing bbox on "(Corporation Name)" text → fields will overlap labels\n' +
    '- RIGHT: placing bbox on the blank ______ line above "(Corporation Name)"\n\n' +
    'Return JSON: { "fields": [...] }';

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    system,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: mediaType, data: base64 },
        },
        {
          type: 'text',
          text: 'Extract all fillable form fields from this document. Return their labels, types, and exact positions as normalized bounding box coordinates (0-1).',
        },
      ],
    }],
    temperature: 0,
    max_tokens: 8000,
  };

  const responseBody = await invokeModel(getBedrockModelId(), JSON.stringify(body));
  const responseJson = JSON.parse(new TextDecoder('utf-8').decode(responseBody)) as Record<string, unknown>;
  const contentBlocks = (responseJson?.content as Array<{ type?: string; text?: string }> | undefined) ?? [];
  const rawText = contentBlocks.find((c) => c?.type === 'text')?.text ?? '';

  const parsed = safeParseJsonFromModel(rawText) as Record<string, unknown> | null;
  const visionFields = Array.isArray(parsed?.fields) ? (parsed.fields as VisionField[]) : [];

  return visionFields.map((vf) => {
    // Normalize bounding box: ensure minimum size, enforce page margins, clamp bounds
    let bbox = vf.boundingBox ?? null;
    if (bbox) {
      // Most documents have ~5-8% margin. If left < 0.04 it's likely a coordinate error.
      const left = bbox.left < 0.04 ? 0.06 : Math.min(0.95, bbox.left);
      const top = Math.max(0.02, Math.min(0.98, bbox.top));
      bbox = {
        top,
        left,
        width: Math.max(0.05, Math.min(0.9 - left, bbox.width)),
        height: Math.max(0.018, Math.min(0.04, bbox.height)),
      };
    }

    return {
      fieldId: uuidv4(),
      label: vf.label || 'Unknown Field',
      value: vf.currentValue || null,
      status: vf.fieldType === 'signature' ? 'MANUAL_REQUIRED' as const
        : vf.fieldType === 'checkbox' ? 'MANUAL_REQUIRED' as const
        : 'EMPTY' as const,
      confidence: 0.9,
      profileFieldKey: null,
      manualReason: vf.fieldType === 'signature' ? 'Requires signature' : null,
      pageNumber: vf.pageNumber ?? 1,
      cellReference: null,
      boundingBox: bbox,
    };
  });
};
