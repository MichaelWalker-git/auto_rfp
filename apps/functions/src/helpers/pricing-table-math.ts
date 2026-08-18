/**
 * pricing-table-math.ts
 *
 * Deterministic totals validation for generated pricing documents (Fix B).
 *
 * LLM-computed table totals are frequently wrong (e.g. a stated "$5,235" over
 * rows that sum to $5,245). This helper parses every <table> in the generated
 * HTML, recomputes each total row's money value from the rows above it, and
 * auto-corrects mismatched total cells before the document is saved.
 *
 * Pure string/regex table walking — generated HTML is well-formed
 * <table><tr><td> (mirrors compliance-review-html.ts), so no HTML parser
 * dependency is needed. Pure function, no I/O.
 *
 * Known v1 limitations (accepted — see PRICING-CONSISTENCY doc §5.3):
 *  - only column totals are verified; `qty × unit = extended` and
 *    formula-in-label math are not recomputed
 *  - money cells are aligned by column position from the END of the row, so
 *    colspan'd total labels still line up with the data column
 */

export interface TotalCorrection {
  tableIndex: number;
  rowLabel: string;
  previousValue: string; // e.g. "$5,235"
  correctedValue: string; // e.g. "$5,245.00"
}

export interface PricingMathResult {
  html: string;
  corrections: TotalCorrection[];
}

// Take the LAST money match in a cell — formula labels like
// "(2 hrs × $105/hr)" precede the actual value.
export const MONEY_RE = /\$\s?(\d[\d,]*(?:\.\d{1,2})?)/g;

export const TABLE_RE = /<table\b[^>]*>[\s\S]*?<\/table>/gi;
export const ROW_RE = /<tr\b[^>]*>[\s\S]*?<\/tr>/gi;
const CELL_RE = /(<t[dh]\b[^>]*>)([\s\S]*?)(<\/t[dh]>)/gi;

/** Absolute difference above which a stated total is rewritten. */
export const TOLERANCE = 1.0;

export const stripTags = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;|&#x0*a0;|&#0*160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();

export const roundCents = (value: number): number => Math.round(value * 100) / 100;

export const formatMoney = (value: number, withCents: boolean): string =>
  `$${roundCents(value).toLocaleString('en-US', {
    minimumFractionDigits: withCents ? 2 : 0,
    maximumFractionDigits: withCents ? 2 : 0,
  })}`;

export interface ParsedCell {
  openTag: string;
  inner: string;
  closeTag: string;
  /** Last money match in the cell, if any. */
  money: { text: string; value: number; hasCents: boolean; innerIndex: number } | null;
}

export const parseCells = (rowHtml: string): Array<ParsedCell & { start: number; end: number }> => {
  const cells: Array<ParsedCell & { start: number; end: number }> = [];
  for (const m of rowHtml.matchAll(CELL_RE)) {
    const [full, openTag, inner, closeTag] = m as unknown as [string, string, string, string];
    let money: ParsedCell['money'] = null;
    for (const moneyMatch of inner.matchAll(MONEY_RE)) {
      const text = moneyMatch[0];
      const digits = moneyMatch[1]!.replace(/,/g, '');
      const value = Number.parseFloat(digits);
      if (Number.isFinite(value)) {
        money = { text, value, hasCents: digits.includes('.'), innerIndex: moneyMatch.index! };
      }
    }
    cells.push({ openTag, inner, closeTag, money, start: m.index!, end: m.index! + full.length });
  }
  return cells;
};

/** Sum accumulator per column offset-from-end. */
interface ColumnSum {
  sum: number;
  hasCents: boolean;
  count: number;
}

const addToColumn = (map: Map<number, ColumnSum>, offset: number, value: number, hasCents: boolean): void => {
  const entry = map.get(offset) ?? { sum: 0, hasCents: false, count: 0 };
  entry.sum = roundCents(entry.sum + value);
  entry.hasCents = entry.hasCents || hasCents;
  entry.count += 1;
  map.set(offset, entry);
};

export const GRAND_LABEL_RE = /\bgrand\b|\boverall\b/i;
// "Total …", "… Total", "Subtotal", "Sub-Total" — \btotal\b alone would miss
// "Subtotal" (no word boundary inside the word).
export const TOTAL_LABEL_RE = /\b(?:sub[\s-]?)?total\b/i;

const processTable = (
  tableHtml: string,
  tableIndex: number,
  corrections: TotalCorrection[],
): string => {
  // Per-row cell replacements: rowStart → rebuilt row html
  const rowReplacements: Array<{ start: number; end: number; html: string }> = [];

  /** Money sums per column offset since the previous total row. */
  let dataSinceLastTotal = new Map<number, ColumnSum>();
  /** Effective (corrected-or-stated) values of prior total rows, per column offset. */
  const priorTotals: Array<Map<number, { value: number; hasCents: boolean }>> = [];

  for (const rowMatch of tableHtml.matchAll(ROW_RE)) {
    const rowHtml = rowMatch[0];
    const cells = parseCells(rowHtml);
    if (cells.length === 0) continue;

    const label = stripTags(cells[0]!.inner);
    const isTotalRow = TOTAL_LABEL_RE.test(label);

    if (!isTotalRow) {
      for (let i = 0; i < cells.length; i++) {
        const money = cells[i]!.money;
        if (money) {
          addToColumn(dataSinceLastTotal, cells.length - 1 - i, money.value, money.hasCents);
        }
      }
      continue;
    }

    const hasDataSinceLastTotal = dataSinceLastTotal.size > 0;
    const isGrandLabel = GRAND_LABEL_RE.test(label);
    // Ambiguous shape: a "Grand Total" that has BOTH subtotals above it and
    // loose data rows since the last subtotal — leave it untouched rather
    // than risk a wrong "correction".
    const isAmbiguousGrand = isGrandLabel && priorTotals.length > 0 && hasDataSinceLastTotal;

    const rowValues = new Map<number, { value: number; hasCents: boolean }>();
    const cellReplacements: Array<{ start: number; end: number; html: string }> = [];

    for (let i = 0; i < cells.length; i++) {
      const cell = cells[i]!;
      if (!cell.money) continue;
      const offset = cells.length - 1 - i;

      let effectiveValue = cell.money.value;
      let effectiveHasCents = cell.money.hasCents;

      if (!isAmbiguousGrand) {
        // Regular totals sum the data rows since the previous total; a
        // GRAND-labeled row directly after subtotals sums the subtotals
        // instead. A non-grand total row with no data rows since the previous
        // total is a COMPONENT row (e.g. "Total ODCs" under "Total Labor" in a
        // reconciliation table) — it is left untouched, but its stated value
        // still feeds `priorTotals` for a later grand total.
        let expected: ColumnSum | null = null;
        if (hasDataSinceLastTotal) {
          expected = dataSinceLastTotal.get(offset) ?? null;
        } else if (isGrandLabel && priorTotals.length > 0) {
          const acc: ColumnSum = { sum: 0, hasCents: false, count: 0 };
          for (const prior of priorTotals) {
            const prev = prior.get(offset);
            if (prev) {
              acc.sum = roundCents(acc.sum + prev.value);
              acc.hasCents = acc.hasCents || prev.hasCents;
              acc.count += 1;
            }
          }
          expected = acc.count > 0 ? acc : null;
        }

        if (expected && expected.count > 0 && Math.abs(cell.money.value - expected.sum) > TOLERANCE) {
          const corrected = formatMoney(expected.sum, expected.hasCents || cell.money.hasCents);
          const inner =
            cell.inner.slice(0, cell.money.innerIndex) +
            corrected +
            cell.inner.slice(cell.money.innerIndex + cell.money.text.length);
          cellReplacements.push({
            start: cell.start,
            end: cell.end,
            html: `${cell.openTag}${inner}${cell.closeTag}`,
          });
          corrections.push({
            tableIndex,
            rowLabel: label,
            previousValue: cell.money.text,
            correctedValue: corrected,
          });
          effectiveValue = expected.sum;
          effectiveHasCents = expected.hasCents || cell.money.hasCents;
        }
      }

      rowValues.set(offset, { value: effectiveValue, hasCents: effectiveHasCents });
    }

    if (cellReplacements.length > 0) {
      let rebuiltRow = '';
      let cursor = 0;
      for (const rep of cellReplacements) {
        rebuiltRow += rowHtml.slice(cursor, rep.start) + rep.html;
        cursor = rep.end;
      }
      rebuiltRow += rowHtml.slice(cursor);
      rowReplacements.push({
        start: rowMatch.index!,
        end: rowMatch.index! + rowHtml.length,
        html: rebuiltRow,
      });
    }

    if (rowValues.size > 0) priorTotals.push(rowValues);
    dataSinceLastTotal = new Map();
  }

  if (rowReplacements.length === 0) return tableHtml;

  let rebuilt = '';
  let cursor = 0;
  for (const rep of rowReplacements) {
    rebuilt += tableHtml.slice(cursor, rep.start) + rep.html;
    cursor = rep.end;
  }
  rebuilt += tableHtml.slice(cursor);
  return rebuilt;
};

/**
 * Parse every <table> in the HTML; for each row whose first cell matches
 * /\btotal\b/i, recompute the money value as the sum of the money cells in the
 * same column position (counted from the end of the row, so colspan'd labels
 * still align) across the non-total rows since the previous total row (or
 * table start). A GRAND-labeled total row with no data rows above it (a grand
 * total directly after subtotals) sums the prior total rows instead; a
 * non-grand total row with no data rows above it is a component row (e.g. a
 * reconciliation table's "Total ODCs") and is never rewritten. If
 * |stated − computed| > $1.00, the cell is rewritten with the computed value —
 * cents are kept only when the source rows carry cents. Rows/tables without
 * money cells are skipped; malformed HTML passes through unchanged.
 */
export const correctPricingTableTotals = (html: string): PricingMathResult => {
  if (!html || !/<table\b/i.test(html)) return { html, corrections: [] };

  const corrections: TotalCorrection[] = [];
  let result = '';
  let cursor = 0;
  let tableIndex = 0;

  for (const tableMatch of html.matchAll(TABLE_RE)) {
    result += html.slice(cursor, tableMatch.index);
    result += processTable(tableMatch[0], tableIndex, corrections);
    cursor = tableMatch.index! + tableMatch[0].length;
    tableIndex += 1;
  }
  result += html.slice(cursor);

  return { html: result, corrections };
};
