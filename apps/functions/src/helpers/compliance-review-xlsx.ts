/**
 * Read an XLSX questionnaire's first sheet from S3 into a bounded cell inventory
 * for the compliance review.
 *
 * XLSX questionnaires (RFP documents with documentType QUESTIONNAIRE, file-based,
 * no htmlContentKey) have NO persisted grid — only the raw .xlsx in S3, keyed by
 * `fileKey`. This reads it at review time so:
 *   - the model can actually read the questionnaire's answers (a whole class of
 *     documents the review was previously blind to), and
 *   - `{ kind: 'cell', sheet, row, col }` anchors can be validated against the
 *     real workbook (previously always `anchorValid: false`).
 *
 * Coordinates match the editor exactly: `sheet` is the sheet NAME, `row`/`col`
 * are 0-based SheetJS `{ r, c }` indices — the same values the questionnaire grid
 * renders as `data-highlight-cell="row,col"` and `highlightCellByCoords` looks up.
 * The editor renders only the FIRST sheet, so we inventory only the first sheet:
 * a validated anchor should be one the editor can actually navigate to.
 */
import * as XLSX from 'xlsx';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

import { requireEnv } from '@/helpers/env';
import { truncateText } from '@/helpers/executive-opportunity-brief';
import {
  MAX_QUESTIONNAIRE_ROWS,
  MAX_QUESTIONNAIRE_COLS,
  MAX_QUESTIONNAIRE_CELLS_STORED,
  MAX_QUESTIONNAIRE_CELL_VALUE_CHARS,
} from '@/constants/compliance-review';

const s3 = new S3Client({});
const getDocumentsBucket = () => requireEnv('DOCUMENTS_BUCKET');

/** One non-empty cell of a questionnaire's first sheet. */
export interface QuestionnaireCell {
  /** 0-based SheetJS row index (== the editor's `data-highlight-cell` row). */
  row: number;
  /** 0-based SheetJS column index (== the editor's `data-highlight-cell` col). */
  col: number;
  /** A1 reference for human display (e.g. "C7"). */
  ref: string;
  value: string;
}

/** The first sheet of an XLSX questionnaire, as a bounded set of non-empty cells. */
export interface QuestionnaireCellInventory {
  /** The sheet NAME the cells belong to (anchors carry the same string). */
  sheetName: string;
  /** Total rows / cols of the used range (pre-cap) for context. */
  totalRows: number;
  totalCols: number;
  /** Non-empty cells (capped at MAX_QUESTIONNAIRE_CELLS_STORED). */
  cells: QuestionnaireCell[];
  /** True when the cap dropped some non-empty cells. */
  truncated: boolean;
}

/**
 * Read the first sheet of the XLSX at `fileKey` into a bounded cell inventory.
 * Returns null if the file can't be read or has no usable sheet. Never throws —
 * questionnaire inventory is best-effort (a missing/corrupt file must not fail
 * the whole review).
 *
 * `maxCellChars` bounds each cell's value length. The default keeps the review
 * prompt small, but the EDIT engine passes `Infinity` to read FULL cell text:
 * proposals' before→after and the apply staleness guard compare against the real
 * cell content, so a truncated value (…[TRUNCATED]) would never match on apply.
 */
export const readQuestionnaireCellInventory = async (
  fileKey: string,
  opts?: { maxCellChars?: number },
): Promise<QuestionnaireCellInventory | null> => {
  const maxCellChars = opts?.maxCellChars ?? MAX_QUESTIONNAIRE_CELL_VALUE_CHARS;
  try {
    const s3Obj = await s3.send(new GetObjectCommand({ Bucket: getDocumentsBucket(), Key: fileKey }));
    const bytes = await s3Obj.Body?.transformToByteArray();
    if (!bytes) return null;

    const workbook = XLSX.read(bytes, { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return null;
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) return null;

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const totalRows = range.e.r - range.s.r + 1;
    const totalCols = range.e.c - range.s.c + 1;

    // Bound the scan window so a pathologically wide/tall sheet can't blow the
    // build or the prompt. Start from row/col 0 (the editor's grid index 0 maps
    // to SheetJS r/c 0 too — a used range starting below 0 is unusual and would
    // only mean we scan a few leading empty rows).
    const lastRow = Math.min(range.e.r, MAX_QUESTIONNAIRE_ROWS - 1);
    const lastCol = Math.min(range.e.c, MAX_QUESTIONNAIRE_COLS - 1);

    const cells: QuestionnaireCell[] = [];
    let truncated = range.e.r > lastRow || range.e.c > lastCol;

    for (let r = 0; r <= lastRow; r++) {
      for (let c = 0; c <= lastCol; c++) {
        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
        if (!cell) continue;
        // Prefer the formatted text (`w`) so dates/numbers read as the user sees
        // them; fall back to the raw value.
        const raw = cell.w !== undefined ? cell.w : cell.v;
        const value = typeof raw === 'string' ? raw : raw == null ? '' : String(raw);
        if (!value.trim()) continue;

        if (cells.length >= MAX_QUESTIONNAIRE_CELLS_STORED) {
          truncated = true;
          return { sheetName, totalRows, totalCols, cells, truncated };
        }
        cells.push({
          row: r,
          col: c,
          ref: XLSX.utils.encode_cell({ r, c }),
          // Number.isFinite guard so the default path stays exact; the engine's
          // Infinity override keeps the full untruncated value.
          value: Number.isFinite(maxCellChars) ? truncateText(value, maxCellChars) : value,
        });
      }
    }

    return { sheetName, totalRows, totalCols, cells, truncated };
  } catch (err) {
    console.warn(
      `[compliance-review-xlsx] failed to read questionnaire cells for ${fileKey}:`,
      (err as Error)?.message,
    );
    return null;
  }
};
