import type { Locator } from '@playwright/test';

/**
 * Pure helpers for the pricing-consistency e2e assertions
 * (docs/PRICING-CONSISTENCY-IMPLEMENTATION.md §13):
 *  - extract rendered tables from the TipTap document editor,
 *  - recompute column totals the way the backend validator does (Fix B),
 *  - detect source-URL leakage (Fix A) and cross-document price drift.
 */

/** A rendered table as trimmed cell text: rows × cells. */
export type ExtractedTable = string[][];

/**
 * Last money match in a cell — labels like "(2 hrs × $105/hr)" precede the
 * value, mirroring the backend's `pricing-table-math` parsing rule.
 */
export const parseMoney = (cellText: string): number | null => {
  const matches = cellText.match(/\$\s?[\d,]+(?:\.\d{1,2})?/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1];
  return Number.parseFloat(last.replace(/[$,\s]/g, ''));
};

const isTotalRow = (row: string[]): boolean => /\btotal\b/i.test(row[0] ?? '');

const isGrandTotalRow = (row: string[]): boolean => /grand|overall/i.test(row[0] ?? '');

/** Last money value in a row (typically the extended-price column). */
const rowMoney = (row: string[]): number | null => {
  for (let i = row.length - 1; i >= 0; i--) {
    const value = parseMoney(row[i] ?? '');
    if (value !== null) return value;
  }
  return null;
};

export interface TotalMismatch {
  tableIndex: number;
  rowLabel: string;
  stated: number;
  computed: number;
}

/**
 * Recompute every total row of every table: a total row must equal the sum of
 * the money rows since the previous total row; a grand-total row (or the last
 * of several total rows) sums the preceding subtotal rows instead. Tolerance
 * mirrors the backend's $1.00 (a small slack added for rounding in rendering).
 */
export const findTotalMismatches = (
  tables: ExtractedTable[],
  toleranceUsd = 1.5,
): TotalMismatch[] => {
  const mismatches: TotalMismatch[] = [];

  tables.forEach((table, tableIndex) => {
    const totalRowIndexes = table
      .map((row, i) => (isTotalRow(row) ? i : -1))
      .filter((i) => i >= 0);
    if (totalRowIndexes.length === 0) return;

    const subtotalValues: number[] = [];
    let sectionStart = 0;

    totalRowIndexes.forEach((totalIndex, position) => {
      const row = table[totalIndex];
      const stated = rowMoney(row);
      if (stated === null) return;

      const isGrand =
        totalRowIndexes.length > 1 &&
        (isGrandTotalRow(row) || position === totalRowIndexes.length - 1);

      let computed: number;
      if (isGrand && subtotalValues.length > 0) {
        computed = subtotalValues.reduce((sum, v) => sum + v, 0);
      } else {
        computed = table
          .slice(sectionStart, totalIndex)
          .filter((r) => !isTotalRow(r))
          .map(rowMoney)
          .filter((v): v is number => v !== null)
          .reduce((sum, v) => sum + v, 0);
        subtotalValues.push(stated);
      }
      sectionStart = totalIndex + 1;

      if (computed > 0 && Math.abs(stated - computed) > toleranceUsd) {
        mismatches.push({ tableIndex, rowLabel: row[0] ?? '', stated, computed });
      }
    });
  });

  return mismatches;
};

/**
 * Tables that look like the third-party services table the documents must
 * copy verbatim from the plan (header mentions a service plus price/tier
 * terminology).
 */
export const findThirdPartyTables = (tables: ExtractedTable[]): ExtractedTable[] =>
  tables.filter((table) => {
    const header = (table[0] ?? []).join(' ').toLowerCase();
    return (
      header.includes('service') &&
      (header.includes('price') || header.includes('tier') || header.includes('billing'))
    );
  });

const normalizeServiceName = (name: string): string =>
  name
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * service → set of money values on its row, for cross-document comparison.
 * Rows without a money value ("vendor quote required — …") map to an empty set.
 */
export const extractServicePrices = (
  thirdPartyTables: ExtractedTable[],
): Map<string, Set<number>> => {
  const services = new Map<string, Set<number>>();
  for (const table of thirdPartyTables) {
    for (const row of table.slice(1)) {
      if (isTotalRow(row)) continue;
      const name = normalizeServiceName(row[0] ?? '');
      if (!name) continue;
      const prices = services.get(name) ?? new Set<number>();
      for (const cell of row) {
        const value = parseMoney(cell);
        if (value !== null) prices.add(value);
      }
      services.set(name, prices);
    }
  }
  return services;
};

/** Header cells matching /source/i — the column Fix A removes from documents. */
export const findSourceColumnHeaders = (tables: ExtractedTable[]): string[] =>
  tables.flatMap((table) => (table[0] ?? []).filter((cell) => /source/i.test(cell)));

/**
 * Read every rendered `<table>` inside the document editor as trimmed cell
 * text. `scope` should already be the loaded `.ProseMirror` content root.
 */
export const extractEditorTables = (scope: Locator): Promise<ExtractedTable[]> =>
  scope.locator('table').evaluateAll((tableNodes) =>
    tableNodes.map((tableNode) =>
      Array.from(tableNode.querySelectorAll('tr')).map((tr) =>
        Array.from(tr.querySelectorAll('td, th')).map(
          (cell) => (cell.textContent ?? '').replace(/\s+/g, ' ').trim(),
        ),
      ),
    ),
  );

/** Full plain text of the editor content, for source/retrieval-date scans. */
export const extractEditorText = async (scope: Locator): Promise<string> =>
  (await scope.innerText()).replace(/\s+/g, ' ');
