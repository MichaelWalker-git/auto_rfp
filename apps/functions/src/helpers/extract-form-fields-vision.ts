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
    'Find ONLY blank spaces where a human needs to write:\n' +
    '- Blank underlines (______)\n' +
    '- Empty labeled fields\n' +
    '- Blank signature lines\n' +
    '- Empty date fields\n\n' +
    'DO NOT extract pre-filled text or agency data.\n\n' +
    'For each field return:\n' +
    '- label: field name\n' +
    '- fieldType: "text" | "signature" | "date" | "address" | "number"\n' +
    '- currentValue: null\n' +
    '- pageNumber: page number (1-indexed)\n' +
    '- boundingBox: { top, left, width, height } normalized 0-1 relative to page\n\n' +
    'Position the boundingBox on the BLANK LINE where someone would write — not on any label text.\n' +
    'height: 0.020\n\n' +
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
    // Normalize bounding box: shift up slightly (Claude tends to position on label, not underline above it)
    let bbox = vf.boundingBox ?? null;
    if (bbox) {
      bbox = {
        top: Math.max(0, Math.min(0.98, bbox.top - 0.03)),
        left: Math.max(0, Math.min(0.95, bbox.left + 0.02)),
        width: Math.max(0.05, Math.min(1 - bbox.left - 0.02, bbox.width)),
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
