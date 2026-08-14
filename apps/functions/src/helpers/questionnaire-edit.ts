/**
 * Guarded, LLM-free cell writer for file-based XLSX questionnaires.
 *
 * XLSX questionnaires (RFP documents with documentType QUESTIONNAIRE, file-based,
 * no htmlContentKey) have content only in the raw .xlsx in S3, keyed by
 * `fileKey`. This writes AI-proposed cell edits back into that workbook:
 *   - GUARDED: per cell the CURRENT value must equal the proposed `before`
 *     (read the same way the review reader reads it), else the cell is
 *     skipped-stale and never clobbered; and
 *   - it PRESERVES the workbook's styling, merges, and all other cells/sheets.
 *
 * IMPORTANT — why exceljs, not SheetJS: the community `xlsx` (SheetJS) build does
 * NOT preserve cell styling on write. A real questionnaire we tested is heavily
 * styled (1658 styled cells — borders/shading/logo area — of which only ~100 hold
 * values); a SheetJS read→write round-trip dropped the 1558 empty-but-styled
 * cells, destroying the form's appearance. exceljs round-trips it losslessly
 * (all 1658 cells + 9 merges intact). The manual questionnaire editor
 * (QuestionnaireViewer) already uses exceljs on save for exactly this reason, so
 * this writer stays at parity with manual edits.
 *
 * Only the targeted cells are mutated. Returns a per-cell result so the caller can
 * report exactly which cells applied.
 */
import ExcelJS from 'exceljs';

import { getFileBufferFromS3, uploadToS3 } from '@/helpers/s3';
import { requireEnv } from '@/helpers/env';

const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface QuestionnaireCellWrite {
  /** A1 reference of the cell (e.g. "C7"). */
  ref: string;
  /** Sheet the cell belongs to; falls back to the first sheet when absent. */
  sheetName: string;
  /** The current cell value the proposal was drafted against (staleness guard). */
  before: string;
  /** The replacement value. */
  after: string;
}

export interface CellWriteResult {
  ref: string;
  status: 'applied' | 'skipped-stale';
  message?: string;
}

/**
 * Read a cell's current display text. exceljs `.text` is the formatted string
 * rendering — the analog of the review reader's `w ?? v` (compliance-review-xlsx),
 * so the guard compares apples to apples with the `before` the proposal carries.
 */
const readCellText = (cell: ExcelJS.Cell): string => {
  const t = cell.text;
  return t == null ? '' : String(t);
};

/**
 * Coerce a replacement string to the value exceljs should store (M3): always
 * writing a string turns a numeric/formula cell into text on an edit. So:
 *  - '' → null (clear the cell), and
 *  - a value that is EXACTLY a finite number (only when the current cell is also
 *    numeric) → a JS number, so the cell keeps its numeric type + number format.
 * Everything else stays a string — including numeric-looking text like a phone
 * number or leading-zero code, which must NOT be coerced (that would drop the
 * zero / reformat it). We only coerce when the cell was already numeric, so a
 * text answer that happens to be digits is left alone.
 */
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;
const coerceCellValue = (after: string, cell: ExcelJS.Cell): string | number | null => {
  if (after === '') return null;
  const cellWasNumeric = typeof cell.value === 'number';
  if (cellWasNumeric && NUMERIC_RE.test(after.trim())) {
    const n = Number(after.trim());
    if (Number.isFinite(n)) return n;
  }
  return after;
};

/**
 * Apply guarded cell writes to the questionnaire .xlsx at `fileKey`, writing the
 * modified workbook back to the SAME key. Loads the workbook once (exceljs,
 * style-preserving), mutates only the cells that pass the staleness guard, and
 * uploads once. `wroteAny` is true when at least one cell was written (so the
 * caller can skip the upload/snapshot bookkeeping when nothing changed).
 */
export const writeQuestionnaireCells = async (args: {
  fileKey: string;
  writes: QuestionnaireCellWrite[];
}): Promise<{ results: CellWriteResult[]; wroteAny: boolean }> => {
  const { fileKey, writes } = args;
  const bucket = getDocumentsBucket();

  const bytes = await getFileBufferFromS3(bucket, fileKey);
  const workbook = new ExcelJS.Workbook();
  // exceljs types accept a Buffer here; load parses the whole workbook.
  await workbook.xlsx.load(bytes as unknown as ArrayBuffer);
  if (workbook.worksheets.length === 0) throw new Error('Workbook has no sheets');

  const resolveSheet = (sheetName: string): ExcelJS.Worksheet | undefined =>
    workbook.getWorksheet(sheetName) ?? workbook.worksheets[0];

  const results: CellWriteResult[] = [];
  let wroteAny = false;

  for (const write of writes) {
    const sheet = resolveSheet(write.sheetName);
    if (!sheet) {
      results.push({ ref: write.ref, status: 'skipped-stale', message: 'Sheet not found' });
      continue;
    }

    const cell = sheet.getCell(write.ref);
    if (readCellText(cell) !== write.before) {
      results.push({
        ref: write.ref,
        status: 'skipped-stale',
        message: 'Cell value changed since proposed',
      });
      continue;
    }

    // Set the value; exceljs preserves the cell's existing style automatically
    // (we assign .value, not the whole cell). Coerce so a numeric cell stays
    // numeric and an empty replacement clears the cell (M3).
    cell.value = coerceCellValue(write.after, cell);
    wroteAny = true;
    results.push({ ref: write.ref, status: 'applied' });
  }

  if (wroteAny) {
    const out = await workbook.xlsx.writeBuffer();
    await uploadToS3(bucket, fileKey, Buffer.from(out as ArrayBuffer), XLSX_MIME);
  }

  return { results, wroteAny };
};
