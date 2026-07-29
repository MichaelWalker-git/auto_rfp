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

// `sheet_to_json({ header: 1 })` yields SPARSE rows — genuinely empty cells are
// holes, not ''. `.map`/`.findIndex` mishandle holes (either preserving them or
// visiting them with `undefined`), so always densify a row through Array.from,
// whose map fn is invoked for every index and fills holes.
const denseRow = (row: unknown[] | undefined): string[] =>
  Array.from(row ?? [], (c) => String(c ?? '').trim());

// A "fill" column is mostly empty across data rows — the blank the vendor
// completes. Measured on the real solicitation sheets this fix targets:
//   • Form 1 "Quoted Unit Price"        → 0%   populated
//   • General Information "Vendor Response" → 9% (its handful of populated cells
//     are the repeated section sub-header rows: "Fleet and Drivers", etc.)
//   • Guidelines "Section" (merged group label) → 50% populated
// A 0.25 ceiling sits cleanly between the real forms (0–9%) and the merged
// label (50%), so it admits genuine blanks and rejects sparse label columns.
// The RELATIVE rule below (fill must be emptier than every context column) is a
// second guard on top of this absolute one.
const FILL_MAX_POPULATED_RATIO = 0.25;
// A "context" column is MOSTLY POPULATED — the line items / cities / questions
// that identify each row. Kept strictly above the fill ceiling so no column can
// be both.
const CONTEXT_MIN_POPULATED_RATIO = 0.5;
// Guard against calling a 1-row block a "table".
const MIN_DATA_ROWS = 2;
// A header row must define at least this many labelled columns to be a table.
const MIN_HEADER_COLS = 2;

type FillLayout = {
  headerRowIdx: number;
  fillCols: number[];
  contextCols: number[];
};

// Detect a fillable TABLE on a non-matrix sheet by STRUCTURE, not header text.
// The reliable, header-agnostic signal for "this is a form the vendor fills":
// a header row with at least one column that is essentially empty below it (the
// fill target) AND at least one column that is mostly populated (the row
// context). This catches pricing tables ("Quoted Unit Price"), location grids
// ("On-Site Service Available?") and questionnaires ("Vendor Response") alike,
// while rejecting fully-populated navigation/instruction tables (Table of
// Contents, Guidelines) that have no empty column to fill.
//
// Recall-biased by design: missing a required form is worse for an RFP
// submission than surfacing an extra one the user can delete. The one class it
// still cannot see is a template pre-filled with placeholder text (no empty
// column), which no purely-structural rule can distinguish from real data.
const findFillLayout = (jsonData: unknown[][]): FillLayout | null => {
  // Anchor the header to the FIRST row with >= MIN_HEADER_COLS populated cells.
  // Rows above it are the title / instruction lines (a single wide cell), and —
  // crucially — we do NOT try lower rows as headers. Without this anchor the
  // scan would eventually interpret a prose BODY row of an instruction sheet as
  // a "header" with an empty column beneath it, turning Guidelines-style sheets
  // into false forms.
  let headerRowIdx = -1;
  const scanLimit = Math.min(jsonData.length, 20);
  for (let i = 0; i < scanLimit; i++) {
    const populated = denseRow(jsonData[i]).filter((c) => c).length;
    if (populated >= MIN_HEADER_COLS) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx < 0) return null;

  const header = denseRow(jsonData[headerRowIdx]);
  // Only LABELLED header columns are candidates. A headerless empty fill column
  // is structurally indistinguishable from an off-the-edge blank column on a
  // navigation table (e.g. a Table of Contents with a trailing empty cell), so
  // there is no safe structural rule for it — that case is covered by the
  // zero-fields backstop in the detect-required-forms handler instead.
  const candidateCols = header.map((h, idx) => (h ? idx : -1)).filter((idx) => idx >= 0);

  let dataRows = 0;
  const populatedCount = new Map<number, number>();
  for (let r = headerRowIdx + 1; r < jsonData.length; r++) {
    const dataRow = denseRow(jsonData[r]);
    if (!dataRow.some((c) => c)) continue; // skip fully-empty rows
    dataRows++;
    for (const c of candidateCols) {
      if (dataRow[c]) populatedCount.set(c, (populatedCount.get(c) ?? 0) + 1);
    }
  }

  if (dataRows < MIN_DATA_ROWS) return null;

  const ratioOf = (c: number) => (populatedCount.get(c) ?? 0) / dataRows;

  const contextCols = candidateCols.filter((c) => ratioOf(c) >= CONTEXT_MIN_POPULATED_RATIO);
  if (contextCols.length === 0) return null;

  // A fill column must be near-empty AND emptier than EVERY context column.
  // The second clause is what stops a sparse label column (e.g. Guidelines'
  // ~29% "Section") from ever being read as a blank to fill.
  const minContextRatio = Math.min(...contextCols.map(ratioOf));
  const fillCols = candidateCols.filter(
    (c) =>
      !contextCols.includes(c) &&
      ratioOf(c) <= FILL_MAX_POPULATED_RATIO &&
      ratioOf(c) < minContextRatio,
  );

  if (fillCols.length === 0) return null;

  return { headerRowIdx, fillCols: fillCols.sort((a, b) => a - b), contextCols };
};

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

  for (let sheetIndex = 0; sheetIndex < workbook.SheetNames.length; sheetIndex++) {
    const sheetName = workbook.SheetNames[sheetIndex];
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
              sheetName,
              sheetIndex,
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
      // Non-matrix sheets need a POSITIVE signal of fillable structure. The old
      // heuristic ("any short cell whose right neighbor is empty") turned every
      // navigation/instruction sheet into a form while missing real forms. We
      // recognize two disciplined layouts:
      //
      //  1. A fillable TABLE — a header row with an essentially-empty "fill"
      //     column (the blank the vendor completes: Quoted Unit Price, On-Site
      //     Available?, Vendor Response) alongside a populated "context" column
      //     (line items, cities, questions). Detected structurally, so header
      //     wording is irrelevant. (findFillLayout)
      //  2. Classic "Label:" cells whose value belongs in the next column.
      //
      // A sheet that matches neither yields no fields and is dropped, so the
      // handler's `sheets.flatMap` naturally excludes it.
      const fillLayout = findFillLayout(jsonData);

      if (fillLayout) {
        const { headerRowIdx: tHeaderIdx, fillCols, contextCols } = fillLayout;
        const header = denseRow(jsonData[tHeaderIdx]);

        for (let rowIdx = tHeaderIdx + 1; rowIdx < jsonData.length; rowIdx++) {
          const row = denseRow(jsonData[rowIdx]);
          if (!row.some((c) => c)) continue; // skip fully-empty rows

          // Row label = the joined context columns (e.g. "0001 · Test Period
          // Mortgage Prepayment Reports", or "Alexander · AR · 72002"). Skip
          // rows with no context text — trailing total/blank rows.
          const contextText = contextCols
            .map((c) => row[c])
            .filter((t) => t)
            .join(' · ');
          if (!contextText) continue;

          // One field per fill column, so multi-blank rows (pricing tables with
          // several vendor-entered columns) surface every blank.
          for (const fc of fillCols) {
            const existing = row[fc];
            const colHeader = header[fc];
            const label = colHeader ? `${contextText} — ${colHeader}` : contextText;
            const valueCellRef = XLSX.utils.encode_cell({ r: rowIdx, c: fc });
            fields.push({
              fieldId: uuidv4(),
              label,
              value: existing || null,
              status: existing ? 'AUTO_FILLED' : 'MANUAL_REQUIRED',
              confidence: null,
              profileFieldKey: null,
              manualReason: existing ? null : 'Vendor response required',
              pageNumber: null,
              cellReference: valueCellRef,
              sheetName,
              sheetIndex,
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
      } else {
        for (let rowIdx = 0; rowIdx < jsonData.length; rowIdx++) {
          const row = jsonData[rowIdx] ?? [];
          for (let colIdx = 0; colIdx < row.length; colIdx++) {
            const cellValue = String(row[colIdx] ?? '');
            // Only an explicit "Label:" cell counts. Requiring the trailing
            // colon is what keeps prose/navigation cells (which never end in
            // ':') from being mistaken for fillable labels.
            if (!cellValue.trim().endsWith(':') || cellValue.trim().length <= 2) continue;

            const nextCol = colIdx + 1 < row.length ? String(row[colIdx + 1] ?? '') : '';
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
              sheetName,
              sheetIndex,
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
