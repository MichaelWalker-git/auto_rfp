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

export interface PageGeometry {
  /**
   * Usable content height per page — page height minus top and bottom margins.
   * A block must fit inside this to avoid crossing into a margin.
   */
  contentAreaPx: number;
  /**
   * Distance from one page's content top to the next page's content top.
   *
   * Set this to the FULL page height, not `contentAreaPx`, to leave a real gap
   * between pages for the running header and footer to occupy. With
   * `pitchPx === contentAreaPx` the pages butt together with zero gap, so any
   * margin band drawn there lands on the previous page's text — which is exactly
   * why the first attempt at an in-canvas header had to be reverted.
   */
  pitchPx: number;
  /** Where the first block's top sits relative to the page grid (the top margin). */
  startOffsetPx: number;
}

/**
 * Decide where spacers belong so no block straddles a page boundary.
 *
 * `startOffsetPx` is load-bearing and easy to miss. ProseMirror applies a single
 * top padding to the whole stream, so the first block begins at `paddingY`, not 0.
 * Sweeping from 0 shifts every boundary test by that amount — verified in a real
 * browser, where the arithmetic reported 0 straddling blocks while the DOM still
 * had 3. Pass the measured offset of the first block.
 */
export const computePageLayout = (
  blocks: readonly LayoutBlock[],
  geometry: PageGeometry | number,
  startOffsetArg = 0,
): LayoutResult => {
  // Accept the older (contentAreaPx, startOffsetPx) form so existing callers and
  // tests keep working; pitch then defaults to the content area.
  const g: PageGeometry =
    typeof geometry === 'number'
      ? { contentAreaPx: geometry, pitchPx: geometry, startOffsetPx: startOffsetArg }
      : geometry;

  const contentAreaPx = g.contentAreaPx;
  const pitchPx = Number.isFinite(g.pitchPx) && g.pitchPx > 0 ? g.pitchPx : contentAreaPx;

  // A non-positive content area would make every division meaningless and could
  // loop; treat it as "no pagination".
  if (!Number.isFinite(contentAreaPx) || contentAreaPx <= 0) {
    return { spacers: [], pageCount: 1 };
  }

  const spacers: LayoutSpacer[] = [];
  const start = Number.isFinite(g.startOffsetPx) ? Math.max(0, g.startOffsetPx) : 0;
  let y = start;

  /** Content-area top of page i. */
  const pageTop = (i: number) => start + i * pitchPx;
  /** Which page a y-coordinate falls on, by content area. */
  const pageOf = (v: number) => Math.max(0, Math.floor((v - start) / pitchPx));

  for (const block of blocks) {
    const height = Math.max(0, block.height);

    if (block.isExplicitBreak) {
      // An explicit break advances to the next page's content top. Adding a spacer
      // as well would produce a double gap.
      y = pageTop(pageOf(y) + 1);
      continue;
    }

    const page = pageOf(y);
    // Offset within this page's content area. `height - 1` so a block ending exactly
    // on the boundary counts as fitting.
    const withinPage = y - pageTop(page);
    const overflows = withinPage + Math.max(0, height - 1) >= contentAreaPx;

    if (overflows) {
      // A block taller than a whole content area can never fit, so pushing it would
      // recurse forever. Place it and let it overflow, as a real renderer does with
      // an oversized image.
      if (height > contentAreaPx) {
        y += height;
        continue;
      }

      const gap = pageTop(page + 1) - y;
      if (gap > 0) {
        spacers.push({ pos: block.pos, height: gap });
        y += gap;
      }
    }

    y += height;
  }

  return {
    spacers,
    pageCount: Math.max(1, pageOf(Math.max(start, y - 1)) + 1),
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
