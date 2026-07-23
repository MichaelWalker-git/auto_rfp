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
 *
 * Multi-sheet routing: each field carries its own `sheetName`/`sheetIndex`
 * (captured by the parser). We write into that sheet. Legacy fields with no
 * sheet identity fall back to the first sheet. Sheets that contain no fields
 * (e.g. an instructions tab) are dropped from the exported workbook so only
 * data sheets reach the user.
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
  if (workbook.SheetNames.length === 0) throw new Error('Workbook has no sheets');

  // Resolve the target sheet name for a field: prefer the explicit name, then
  // the captured index, then fall back to the first sheet for legacy fields.
  const resolveSheetName = (field: DetectedFormField): string => {
    if (field.sheetName && workbook.Sheets[field.sheetName]) return field.sheetName;
    if (field.sheetIndex !== null && workbook.SheetNames[field.sheetIndex]) {
      return workbook.SheetNames[field.sheetIndex];
    }
    return workbook.SheetNames[0];
  };

  // Track which sheets actually receive fields so we can strip the rest.
  const sheetsWithData = new Set<string>();

  for (const field of fields) {
    if (!field.cellReference) continue;

    const targetSheetName = resolveSheetName(field);
    const sheet = workbook.Sheets[targetSheetName];
    if (!sheet) continue;
    // A sheet is "data" as soon as it owns a field, even if that field is empty —
    // the tab is meaningful to the user and must survive the export.
    sheetsWithData.add(targetSheetName);

    let value: string | null = null;
    if (field.markType === 'CHECKBOX' || field.markType === 'CIRCLE') {
      value = field.markChar;
    } else if (field.value) {
      value = field.value;
    }

    if (value === null || value === '') continue;

    sheet[field.cellReference] = { t: 's', v: value };
  }

  // Drop sheets that carry no fields (instructions/empty tabs) so the exported
  // workbook mirrors what the editor shows. Never drop everything — if nothing
  // matched (all-legacy edge case), keep the original workbook intact.
  if (sheetsWithData.size > 0) {
    for (const name of [...workbook.SheetNames]) {
      if (!sheetsWithData.has(name)) {
        delete workbook.Sheets[name];
        workbook.SheetNames = workbook.SheetNames.filter((n) => n !== name);
      }
    }
  }

  const out = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  await uploadToS3(bucket, outputKey, Buffer.from(out), XLSX_MIME);

  return outputKey;
};
