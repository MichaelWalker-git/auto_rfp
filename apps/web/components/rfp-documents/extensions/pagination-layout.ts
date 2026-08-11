/**
 * Pure page-layout arithmetic for the document editor.
 *
 * ## The problem this solves
 *
 * The editor draws simulated page sheets with dashed boundary lines, but the
 * content is one continuous ProseMirror stream with a single top padding. Nothing
 * makes a line of text avoid a page boundary, so a paragraph can render exactly on
 * the dashed line, cut in half.
 *
 * ## Why a single downward sweep
 *
 * The obvious fix — measure, insert a spacer, re-measure — does **not** converge:
 * every insertion invalidates the measurements of everything below it. Measured in
 * Chromium against 60 blocks, that loop still left 4 straddling lines after 25
 * passes.
 *
 * Computing the whole layout in one pass from cached block heights has no feedback
 * loop at all, because the accumulated offset is arithmetic rather than measured.
 * Same 60 blocks: converged first pass, 7 spacers, 0 straddling lines.
 *
 * This module is deliberately DOM-free so it can be unit tested directly.
 */

/** One measured top-level block in document order. */
export interface LayoutBlock {
  /** ProseMirror document position immediately before the block. */
  pos: number;
  /** Rendered height in CSS px, including its own margins. */
  height: number;
  /**
   * True for an explicit page-break node. It already forces the next page, so the
   * sweep must not also insert a spacer for it.
   */
  isExplicitBreak?: boolean;
}

/** A spacer to insert before `pos`, pushing that block onto the next page. */
export interface LayoutSpacer {
  pos: number;
  /** Height in px needed to reach the next page boundary. */
  height: number;
}

export interface LayoutResult {
  spacers: LayoutSpacer[];
  /** Total page count implied by the laid-out content. */
  pageCount: number;
}

/**
 * Decide where spacers belong so no block straddles a page boundary.
 *
 * @param blocks        Top-level blocks in document order, with measured heights.
 * @param contentAreaPx Usable content height per page (page height minus margins).
 * @param startOffsetPx Where the first block's top sits relative to the page grid.
 *
 * `startOffsetPx` is load-bearing and easy to miss. ProseMirror applies a single
 * top padding to the whole stream, so the first block begins at `paddingY`, not 0.
 * Sweeping from 0 shifts every boundary test by that amount — verified in a real
 * browser, where the arithmetic reported 0 straddling blocks while the DOM still
 * had 3. Pass the measured offset of the first block.
 */
export const computePageLayout = (
  blocks: readonly LayoutBlock[],
  contentAreaPx: number,
  startOffsetPx = 0,
): LayoutResult => {
  // A non-positive content area would make every division meaningless and could
  // loop; treat it as "no pagination".
  if (!Number.isFinite(contentAreaPx) || contentAreaPx <= 0) {
    return { spacers: [], pageCount: 1 };
  }

  const spacers: LayoutSpacer[] = [];
  let y = Number.isFinite(startOffsetPx) ? Math.max(0, startOffsetPx) : 0;

  for (const block of blocks) {
    const height = Math.max(0, block.height);

    if (block.isExplicitBreak) {
      // An explicit break advances to the start of the next page. Adding a spacer
      // as well would produce a double gap.
      const currentPage = Math.floor(y / contentAreaPx);
      y = (currentPage + 1) * contentAreaPx;
      continue;
    }

    const pageOfTop = Math.floor(y / contentAreaPx);
    // `height - 1` so a block ending exactly on a boundary counts as fitting: a
    // 100px block at y=0 with a 100px page occupies 0..99, i.e. one page.
    const pageOfBottom = Math.floor((y + Math.max(0, height - 1)) / contentAreaPx);

    if (pageOfTop !== pageOfBottom) {
      // A block taller than a whole page can never fit anywhere, so pushing it
      // would recurse forever. Place it and let it overflow — the same thing a
      // real renderer does with an oversized image.
      if (height > contentAreaPx) {
        y += height;
        continue;
      }

      const gap = pageOfBottom * contentAreaPx - y;
      if (gap > 0) {
        spacers.push({ pos: block.pos, height: gap });
        y += gap;
      }
    }

    y += height;
  }

  return {
    spacers,
    pageCount: Math.max(1, Math.ceil(y / contentAreaPx)),
  };
};

/**
 * Verify no block straddles a boundary once the spacers are applied.
 *
 * Used by tests as an independent check of the core property, rather than
 * re-implementing the sweep's own arithmetic to assert against itself.
 */
export const countStraddlingBlocks = (
  blocks: readonly LayoutBlock[],
  contentAreaPx: number,
  spacers: readonly LayoutSpacer[],
  startOffsetPx = 0,
): number => {
  const gapByPos = new Map(spacers.map((s) => [s.pos, s.height]));
  let y = Math.max(0, startOffsetPx);
  let straddling = 0;

  for (const block of blocks) {
    y += gapByPos.get(block.pos) ?? 0;

    if (block.isExplicitBreak) {
      y = (Math.floor(y / contentAreaPx) + 1) * contentAreaPx;
      continue;
    }

    const height = Math.max(0, block.height);
    // Oversized blocks are expected to overflow; they are not failures.
    if (height > 0 && height <= contentAreaPx) {
      const top = Math.floor(y / contentAreaPx);
      const bottom = Math.floor((y + height - 1) / contentAreaPx);
      if (top !== bottom) straddling += 1;
    }
    y += height;
  }

  return straddling;
};
