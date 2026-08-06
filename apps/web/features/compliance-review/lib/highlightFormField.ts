/**
 * Ephemeral, export-safe highlighting inside the XLSX / PDF form editors.
 *
 * Mirrors highlightInEditor.ts (the HTML rich-text highlighter) for the two
 * field-based editors. Locates the target purely in the live DOM — via the
 * PDF overlay's `#field-${fieldId}` node, or the `data-*` locator attributes
 * the XLSX grid/sidebar render — then scrolls to it and flashes an inset ring +
 * background tint (an offset outline is invisible on a dense grid cell, painted
 * over by adjacent cells). DOM-only; never persisted, so form export is unaffected.
 *
 * The editors own the state a jump needs (active XLSX sheet, PDF active field);
 * they set that first, then call these after a short delay so the target node
 * is in the DOM.
 */

import { scrollToAndFlashCell, normalizeForMatch } from './domHighlight';

/** Attribute the XLSX grid + sidebar put on nodes that own a form field. */
export const FIELD_LOCATOR_ATTR = 'data-highlight-field';
/** Attribute the XLSX grid puts on every cell: `"row,col"`. */
export const CELL_LOCATOR_ATTR = 'data-highlight-cell';

/**
 * Scroll to + flash the node for `fieldId`. Matches either the PDF overlay
 * (`#field-<id>`) or any node tagged with FIELD_LOCATOR_ATTR (XLSX grid cell /
 * sidebar row). Returns true if a node was found.
 */
export const highlightFieldById = (fieldId: string): boolean => {
  const byId = document.getElementById(`field-${fieldId}`);
  if (byId) {
    scrollToAndFlashCell(byId);
    return true;
  }
  const escaped =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(fieldId)
      : fieldId.replace(/["\\]/g, '\\$&');
  const byAttr = document.querySelector<HTMLElement>(`[${FIELD_LOCATOR_ATTR}="${escaped}"]`);
  if (byAttr) {
    scrollToAndFlashCell(byAttr);
    return true;
  }
  return false;
};

/** Scroll to + flash the XLSX cell at `row,col` (0-indexed). Returns true if found. */
export const highlightCellByCoords = (row: number, col: number): boolean => {
  const el = document.querySelector<HTMLElement>(`[${CELL_LOCATOR_ATTR}="${row},${col}"]`);
  if (!el) return false;
  scrollToAndFlashCell(el);
  return true;
};

/**
 * Active snippet search inside a container: find the first text node containing
 * `snippet`, scroll to + flash its element. Fallback when the anchor didn't
 * resolve. Returns true on match. `container` defaults to document.body.
 */
export const highlightFormSnippet = (snippet: string, container?: HTMLElement | null): boolean => {
  const root = container ?? document.body;
  if (!root) return false;
  const needle = normalizeForMatch(snippet);
  if (!needle) return false;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = normalizeForMatch(node.textContent ?? '');
    if (text && text.includes(needle)) {
      const el = node.parentElement;
      if (el) {
        scrollToAndFlashCell(el);
        return true;
      }
    }
  }
  return false;
};

/** Parse a `?highlightCell=sheet,row,col` param into its parts, or null. */
export const parseHighlightCell = (
  raw: string | null | undefined,
): { sheet: string; row: number; col: number } | null => {
  if (!raw) return null;
  // Sheet names can contain commas, so split from the right: the last two
  // segments are row,col and everything before is the sheet name.
  const idx2 = raw.lastIndexOf(',');
  if (idx2 <= 0) return null;
  const idx1 = raw.lastIndexOf(',', idx2 - 1);
  if (idx1 <= 0) return null;
  const sheet = raw.slice(0, idx1);
  const row = Number(raw.slice(idx1 + 1, idx2));
  const col = Number(raw.slice(idx2 + 1));
  if (!sheet || !Number.isInteger(row) || !Number.isInteger(col)) return null;
  return { sheet, row, col };
};
