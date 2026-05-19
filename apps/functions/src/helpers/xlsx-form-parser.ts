import * as XLSX from 'xlsx';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

import { requireEnv } from './env';

import type { DetectedFormField, FormType } from '@auto-rfp/core';

const s3 = new S3Client({});
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');

const MATRIX_HEADER_PATTERNS = [
  /fully\s*meets/i,
  /partially\s*meets/i,
  /cannot\s*meet/i,
  /does\s*not\s*meet/i,
  /compliant/i,
  /non[-\s]?compliant/i,
];

const COMMENTS_PATTERNS = [
  /comment/i,
  /additional\s*info/i,
  /notes/i,
  /explanation/i,
  /description/i,
];

type ParsedSheet = {
  sheetName: string;
  formType: FormType;
  fields: DetectedFormField[];
};

const isMatrixSheet = (headers: string[]): boolean => {
  const matchCount = headers.filter((h) =>
    MATRIX_HEADER_PATTERNS.some((p) => p.test(h)),
  ).length;
  return matchCount >= 2;
};

const findCommentsColumnIndex = (headers: string[]): number => {
  return headers.findIndex((h) => COMMENTS_PATTERNS.some((p) => p.test(h)));
};

export const parseXlsxForms = async (fileKey: string): Promise<ParsedSheet[]> => {
  const bucket = getDocumentsBucket();

  const s3Obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: fileKey }));
  const bytes = await s3Obj.Body?.transformToByteArray();
  if (!bytes) throw new Error(`Could not read S3 object: ${fileKey}`);

  const workbook = XLSX.read(bytes, { type: 'array' });
  const results: ParsedSheet[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown as unknown[][];
    if (jsonData.length < 2) continue;

    const headerRow = (jsonData[0] ?? []).map((cell) => String(cell ?? ''));
    const isMatrix = isMatrixSheet(headerRow);

    const fields: DetectedFormField[] = [];

    if (isMatrix) {
      const commentsCol = findCommentsColumnIndex(headerRow);
      const featureCol = headerRow.findIndex((h) =>
        /feature|requirement|item|capability/i.test(h),
      );

      for (let rowIdx = 1; rowIdx < jsonData.length; rowIdx++) {
        const row = jsonData[rowIdx] ?? [];
        const featureText = featureCol >= 0 ? String(row[featureCol] ?? '') : '';
        if (!featureText.trim()) continue;

        for (let colIdx = 0; colIdx < headerRow.length; colIdx++) {
          const header = headerRow[colIdx];
          if (!header) continue;

          const isResponseCol = MATRIX_HEADER_PATTERNS.some((p) => p.test(header));
          const isCommentsCol = colIdx === commentsCol;

          if (isResponseCol || isCommentsCol) {
            const cellRef = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
            fields.push({
              fieldId: uuidv4(),
              label: `${featureText} — ${header}`,
              value: String(row[colIdx] ?? '') || null,
              status: isResponseCol ? 'MANUAL_REQUIRED' : 'EMPTY',
              confidence: null,
              profileFieldKey: null,
              manualReason: isResponseCol ? 'Compliance determination requires manual review' : null,
              pageNumber: null,
              cellReference: cellRef,
              boundingBox: null,
            });
          }
        }
      }

      results.push({ sheetName, formType: 'XLSX_MATRIX', fields });
    } else {
      for (let rowIdx = 0; rowIdx < jsonData.length; rowIdx++) {
        const row = jsonData[rowIdx] ?? [];
        for (let colIdx = 0; colIdx < row.length; colIdx++) {
          const cellValue = String(row[colIdx] ?? '');
          if (!cellValue.trim()) continue;

          const nextCol = colIdx + 1 < row.length ? String(row[colIdx + 1] ?? '') : '';
          const looksLikeLabel = cellValue.endsWith(':') || (cellValue.length < 50 && !nextCol.trim());

          if (looksLikeLabel && cellValue.length > 2) {
            const valueCellRef = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx + 1 });
            fields.push({
              fieldId: uuidv4(),
              label: cellValue.replace(/:$/, '').trim(),
              value: nextCol.trim() || null,
              status: 'EMPTY',
              confidence: null,
              profileFieldKey: null,
              manualReason: null,
              pageNumber: null,
              cellReference: valueCellRef,
              boundingBox: null,
            });
          }
        }
      }

      if (fields.length > 0) {
        results.push({ sheetName, formType: 'XLSX_FORM', fields });
      }
    }
  }

  return results;
};
