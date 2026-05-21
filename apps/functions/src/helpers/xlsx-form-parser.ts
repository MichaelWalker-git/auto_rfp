import * as XLSX from 'xlsx';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';

import { requireEnv } from './env';

import type { DetectedFormField, FieldMarkType, FormType, MatrixColumn } from '@auto-rfp/core';

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

const CHECKBOX_HEADER_PATTERNS = [
  /^\s*(yes|no)\s*$/i,
  /^\s*[✓☑☒☐]\s*$/,
  /\bcheck(?:box|mark)?\b/i,
];

const CIRCLE_HEADER_PATTERNS = [
  /\b(en)?circle\b/i,
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

const classifyMatrixColumn = (header: string, isCommentsCol: boolean): MatrixColumn => {
  if (isCommentsCol) return 'COMMENTS';
  if (/fully\s*meets|^\s*compliant/i.test(header)) return 'FULLY_MEETS';
  if (/partially\s*meets/i.test(header)) return 'PARTIALLY_MEETS';
  if (/cannot\s*meet|does\s*not\s*meet|non[-\s]?compliant/i.test(header)) return 'CANNOT_MEET';
  return 'OTHER';
};

const isCheckMark = (raw: string): boolean => /^[xX✓☑]$/.test(raw.trim());
const isCircleMark = (raw: string): boolean => /^[○oO◯⭕]$/.test(raw.trim());

const detectColumnMarkType = (header: string, sampleValues: string[]): FieldMarkType => {
  if (CIRCLE_HEADER_PATTERNS.some((p) => p.test(header))) return 'CIRCLE';
  if (CHECKBOX_HEADER_PATTERNS.some((p) => p.test(header))) return 'CHECKBOX';
  // Heuristic on cell values: if every non-empty sample is a single mark char,
  // treat the column as a checkbox column (covers "X" / "✓" only matrices).
  const populated = sampleValues.filter((v) => v.trim().length > 0);
  if (populated.length >= 2) {
    if (populated.every(isCircleMark)) return 'CIRCLE';
    if (populated.every(isCheckMark)) return 'CHECKBOX';
  }
  return 'TEXT';
};

// Walk rows above the matrix header looking for a single-cell row that names
// the section (e.g. "Cybersecurity Requirements"). Returns the most recent
// section header, or null if none.
const findSectionHeader = (rowsAbove: unknown[][]): string | null => {
  for (let i = rowsAbove.length - 1; i >= 0; i--) {
    const row = (rowsAbove[i] ?? []).map((c) => String(c ?? '').trim());
    const populated = row.filter((c) => c.length > 0);
    if (populated.length === 1 && populated[0].length > 4) {
      const header = populated[0];
      if (!MATRIX_HEADER_PATTERNS.some((p) => p.test(header))) {
        return header;
      }
    }
  }
  return null;
};

// Find which row index contains the matrix header. Falls back to row 0.
const findMatrixHeaderRow = (jsonData: unknown[][]): number => {
  for (let i = 0; i < Math.min(jsonData.length, 20); i++) {
    const row = (jsonData[i] ?? []).map((c) => String(c ?? ''));
    if (isMatrixSheet(row)) return i;
  }
  return 0;
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

    const headerRowIdx = findMatrixHeaderRow(jsonData);
    const headerRow = (jsonData[headerRowIdx] ?? []).map((cell) => String(cell ?? ''));
    const isMatrix = isMatrixSheet(headerRow);

    const fields: DetectedFormField[] = [];

    if (isMatrix) {
      const commentsCol = findCommentsColumnIndex(headerRow);
      const featureCol = headerRow.findIndex((h) =>
        /feature|requirement|item|capability/i.test(h),
      );
      const sectionHeader = findSectionHeader(jsonData.slice(0, headerRowIdx));

      // Sample up to 10 cells per column to detect mark-only columns.
      const columnSamples: string[][] = headerRow.map((_, colIdx) => {
        const samples: string[] = [];
        for (let r = headerRowIdx + 1; r < jsonData.length && samples.length < 10; r++) {
          samples.push(String((jsonData[r] ?? [])[colIdx] ?? ''));
        }
        return samples;
      });

      const columnMarkTypes: FieldMarkType[] = headerRow.map((header, colIdx) =>
        detectColumnMarkType(header, columnSamples[colIdx] ?? []),
      );

      for (let rowIdx = headerRowIdx + 1; rowIdx < jsonData.length; rowIdx++) {
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
            const matrixColumn = classifyMatrixColumn(header, isCommentsCol);
            const markType = columnMarkTypes[colIdx] ?? 'TEXT';
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
              markType,
              markChar: null,
              markGeometry: null,
              matrixCategory: sectionHeader,
              matrixFeature: featureText.trim(),
              matrixColumn,
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
              markType: 'TEXT',
              markChar: null,
              markGeometry: null,
              matrixCategory: null,
              matrixFeature: null,
              matrixColumn: 'OTHER',
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
