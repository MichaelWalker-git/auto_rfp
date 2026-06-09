/**
 * Excel/Spreadsheet Utilities
 *
 * Shared functions for working with Excel files and column/row operations.
 */

/**
 * Convert Excel column letter(s) to zero-based index.
 * Examples: A → 0, B → 1, Z → 25, AA → 26, AB → 27
 */
export const columnLetterToIndex = (col: string): number => {
  let index = 0;
  for (let i = 0; i < col.length; i++) {
    index = index * 26 + col.toUpperCase().charCodeAt(i) - 64;
  }
  return index - 1;
};
