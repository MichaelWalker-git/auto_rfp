import * as XLSX from 'xlsx';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

import { uploadToS3 } from './s3';
import { requireEnv } from './env';

import type { DetectedFormField } from '@auto-rfp/core';

const s3 = new S3Client({});
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Write filled values back into the user's original XLSX. Cells are addressed
 * by `field.cellReference` (which the parser captured at extraction time).
 *
 * - Text fields: write `field.value` directly.
 * - CHECKBOX fields: write `field.markChar` (usually `'X'`) when set.
 * - CIRCLE fields: write `field.markChar` (usually `'○'`) when set.
 * - Empty / unset fields are left as-is.
 */
export const fillXlsxForm = async (args: {
  sourceFileKey: string;
  fields: DetectedFormField[];
  outputKey: string;
}): Promise<string> => {
  const { sourceFileKey, fields, outputKey } = args;
  const bucket = getDocumentsBucket();

  const s3Obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: sourceFileKey }));
  const bytes = await s3Obj.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Could not read XLSX from S3: ${sourceFileKey}`);

  const workbook = XLSX.read(bytes, { type: 'array' });

  // Apply each filled field to the first sheet that has its cell. Most matrices
  // live on a single sheet, so we don't need per-sheet routing yet.
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('Workbook has no sheets');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Sheet ${sheetName} not found`);

  for (const field of fields) {
    if (!field.cellReference) continue;

    let value: string | null = null;
    if (field.markType === 'CHECKBOX' || field.markType === 'CIRCLE') {
      value = field.markChar;
    } else if (field.value) {
      value = field.value;
    }

    if (value === null || value === '') continue;

    sheet[field.cellReference] = { t: 's', v: value };
  }

  const out = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  await uploadToS3(bucket, outputKey, Buffer.from(out), XLSX_MIME);

  return outputKey;
};
