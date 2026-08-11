/**
 * Tests for the page-layout sweep.
 *
 * The core property — "no block straddles a page boundary" — is checked with an
 * independent verifier (`countStraddlingBlocks`) rather than by re-deriving the
 * sweep's own arithmetic, so a bug in the sweep cannot hide behind a matching bug
 * in the assertion.
 */

import {
  computePageLayout,
  countStraddlingBlocks,
  type LayoutBlock,
} from '../pagination-layout';

/** Build blocks from a list of heights, positions spaced so they are distinct. */
const blocksFromHeights = (heights: readonly number[]): LayoutBlock[] =>
  heights.map((height, i) => ({ pos: i * 10, height }));

const PAGE = 912; // Letter content area: 1056 - 2*72

describe('computePageLayout — core property', () => {
  it('leaves nothing straddling for uniform lines', () => {
    // 24px lines is the real case: 60 of them overflow several pages.
    const blocks = blocksFromHeights(Array.from({ length: 60 }, () => 24));
    const { spacers } = computePageLayout(blocks, PAGE);
    expect(countStraddlingBlocks(blocks, PAGE, spacers)).toBe(0);
  });

  it.each([
    ['ragged heights', [24, 80, 24, 300, 24, 500, 24, 120, 700, 24, 24, 400]],
    ['all tall-ish', [400, 400, 400, 400, 400, 400]],
    ['mixed with headings', [48, 24, 24, 36, 24, 24, 24, 200, 24, 24, 60, 24, 24, 24]],
    ['many tiny', Array.from({ length: 200 }, () => 12)],
    ['exact page multiples', [PAGE, PAGE, PAGE]],
    ['just over a page', [PAGE - 1, 2, PAGE - 1, 2]],
  ])('leaves nothing straddling: %s', (_label, heights) => {
    const blocks = blocksFromHeights(heights as number[]);
    const { spacers } = computePageLayout(blocks, PAGE);
    expect(countStraddlingBlocks(blocks, PAGE, spacers)).toBe(0);
  });

  it('is deterministic — the same input yields the same spacers', () => {
    const blocks = blocksFromHeights([24, 500, 24, 700, 300]);
    const a = computePageLayout(blocks, PAGE);
    const b = computePageLayout(blocks, PAGE);
    expect(a.spacers).toEqual(b.spacers);
  });

  it('converges in a single pass — re-running over the result adds nothing', () => {
    // The naive measure-insert-remeasure loop failed to converge (25 passes, 4
    // straddling lines). This asserts the sweep is a fixed point.
    const heights = [24, 300, 500, 24, 700, 24, 400, 24];
    const blocks = blocksFromHeights(heights);
    const first = computePageLayout(blocks, PAGE);

    // Feed the spacers back in as real blocks and sweep again: no new spacers.
    const withSpacers: LayoutBlock[] = [];
    const gapByPos = new Map(first.spacers.map((s) => [s.pos, s.height]));
    for (const b of blocks) {
      const gap = gapByPos.get(b.pos);
      if (gap) withSpacers.push({ pos: b.pos - 1, height: gap });
      withSpacers.push(b);
    }
    expect(computePageLayout(withSpacers, PAGE).spacers).toEqual([]);
  });
});

describe('computePageLayout — spacer placement', () => {
  it('inserts no spacer when everything fits on one page', () => {
    const { spacers, pageCount } = computePageLayout(blocksFromHeights([24, 24, 24]), PAGE);
    expect(spacers).toEqual([]);
    expect(pageCount).toBe(1);
  });

  it('pushes a straddling block to the next page boundary', () => {
    // 900 + 24 crosses 912, so the second block must start exactly at 912.
    const blocks = blocksFromHeights([900, 24]);
    const { spacers } = computePageLayout(blocks, PAGE);
    expect(spacers).toEqual([{ pos: 10, height: 12 }]);
  });

  it('treats a block ending exactly on the boundary as fitting', () => {
    // 912px in a 912px page occupies 0..911 — one page, no spacer.
    expect(computePageLayout(blocksFromHeights([PAGE]), PAGE).spacers).toEqual([]);
  });

  it('never emits a zero or negative spacer', () => {
    const blocks = blocksFromHeights([100, 200, 900, 24, 700, 24, 24]);
    for (const s of computePageLayout(blocks, PAGE).spacers) {
      expect(s.height).toBeGreaterThan(0);
    }
  });
});

describe('computePageLayout — oversized blocks', () => {
  it('places a block taller than a page instead of pushing it forever', () => {
    // A giant image cannot fit on any page; pushing it would loop.
    const blocks = blocksFromHeights([24, PAGE * 3, 24]);
    const { spacers } = computePageLayout(blocks, PAGE);
    // It may get one spacer to start on a fresh page, but must not recurse.
    expect(spacers.length).toBeLessThanOrEqual(2);
    expect(spacers.every((s) => Number.isFinite(s.height))).toBe(true);
  });

  it('terminates with several consecutive oversized blocks', () => {
    const blocks = blocksFromHeights([PAGE * 2, PAGE * 2, PAGE * 2]);
    const { pageCount } = computePageLayout(blocks, PAGE);
    expect(Number.isFinite(pageCount)).toBe(true);
    expect(pageCount).toBeGreaterThan(1);
  });
});

describe('computePageLayout — explicit page breaks', () => {
  it('advances to the next page without adding a spacer', () => {
    const blocks: LayoutBlock[] = [
      { pos: 0, height: 24 },
      { pos: 10, height: 0, isExplicitBreak: true },
      { pos: 20, height: 24 },
    ];
    const { spacers, pageCount } = computePageLayout(blocks, PAGE);
    // The break itself supplies the gap — a spacer too would double it.
    expect(spacers).toEqual([]);
    expect(pageCount).toBe(2);
  });

  it('does not double-space a break that lands mid-page', () => {
    const blocks: LayoutBlock[] = [
      { pos: 0, height: 400 },
      { pos: 10, height: 0, isExplicitBreak: true },
      { pos: 20, height: 400 },
      { pos: 30, height: 0, isExplicitBreak: true },
      { pos: 40, height: 24 },
    ];
    expect(computePageLayout(blocks, PAGE).spacers).toEqual([]);
    expect(computePageLayout(blocks, PAGE).pageCount).toBe(3);
  });
});

describe('computePageLayout — edge cases', () => {
  it('handles an empty document', () => {
    expect(computePageLayout([], PAGE)).toEqual({ spacers: [], pageCount: 1 });
  });

  it('handles zero-height blocks without emitting spacers', () => {
    expect(computePageLayout(blocksFromHeights([0, 0, 0]), PAGE).spacers).toEqual([]);
  });

  it('treats a non-positive content area as "no pagination" rather than looping', () => {
    // Guards against a divide-by-zero producing Infinity and an unbounded loop.
    expect(computePageLayout(blocksFromHeights([24, 24]), 0)).toEqual({ spacers: [], pageCount: 1 });
    expect(computePageLayout(blocksFromHeights([24, 24]), -5).spacers).toEqual([]);
  });

  it('ignores negative heights rather than moving content upward', () => {
    const { spacers } = computePageLayout(
      [{ pos: 0, height: -100 }, { pos: 10, height: 24 }],
      PAGE,
    );
    expect(spacers).toEqual([]);
  });

  it('reports a page count consistent with the laid-out height', () => {
    // Two 900px blocks: the second is pushed to page 2, so 2 pages.
    expect(computePageLayout(blocksFromHeights([900, 900]), PAGE).pageCount).toBe(2);
  });
});

describe('computePageLayout — start offset (the browser-verification bug)', () => {
  /**
   * These exist because the unit tests passed while the REAL DOM still had 3
   * straddling blocks. ProseMirror applies one top padding to the whole stream, so
   * content begins at `paddingY`, not 0. Sweeping from 0 shifted every boundary
   * test by 72px. Arithmetic-only tests could not see it.
   */
  const PADDING_Y = 72;

  it('respects a start offset when deciding boundaries', () => {
    // At offset 0 an 880px block fits page 1 (0..879 < 912). Starting at 72 it
    // spans 72..951, which crosses 912 and must be pushed.
    const blocks = blocksFromHeights([880]);
    expect(computePageLayout(blocks, PAGE, 0).spacers).toEqual([]);
    expect(computePageLayout(blocks, PAGE, PADDING_Y).spacers).toHaveLength(1);
  });

  it('leaves nothing straddling when the offset is applied consistently', () => {
    const blocks = blocksFromHeights(Array.from({ length: 80 }, () => 40));
    const { spacers } = computePageLayout(blocks, PAGE, PADDING_Y);
    expect(countStraddlingBlocks(blocks, PAGE, spacers, PADDING_Y)).toBe(0);
  });

  it('would FAIL to fix the layout if the offset were ignored', () => {
    // Locks in the exact regression found in the browser: sweeping from 0 while the
    // content actually starts at paddingY leaves blocks straddling. These heights
    // are a case where ignoring the offset provably leaves 2 straddling blocks.
    const heights = [
      40, 28, 48, 300, 24, 24, 500, 120, 24, 40, 120, 24, 120, 28, 24, 24, 48, 48, 24, 28,
      24, 120, 48, 24, 500, 120, 24, 28, 300, 300, 120, 24, 120, 120, 48, 24, 28, 24, 120, 500,
    ];
    const blocks = blocksFromHeights(heights);

    const ignoringOffset = computePageLayout(blocks, PAGE, 0).spacers;
    expect(countStraddlingBlocks(blocks, PAGE, ignoringOffset, PADDING_Y)).toBe(2);

    const applyingOffset = computePageLayout(blocks, PAGE, PADDING_Y).spacers;
    expect(countStraddlingBlocks(blocks, PAGE, applyingOffset, PADDING_Y)).toBe(0);
  });

  it.each([0, 24, 72, 96, 200])('leaves nothing straddling for offset %ipx', (offset) => {
    const blocks = blocksFromHeights([48, 24, 300, 24, 700, 24, 400, 24, 24, 500]);
    const { spacers } = computePageLayout(blocks, PAGE, offset);
    expect(countStraddlingBlocks(blocks, PAGE, spacers, offset)).toBe(0);
  });

  it('ignores a negative or non-finite offset rather than shifting content up', () => {
    const blocks = blocksFromHeights([24, 24]);
    expect(computePageLayout(blocks, PAGE, -50).spacers).toEqual([]);
    expect(computePageLayout(blocks, PAGE, Number.NaN).spacers).toEqual([]);
  });
});

describe('computePageLayout — idempotence (the jitter bug)', () => {
  /**
   * The extension re-measures after applying spacers. If the measured input reflects
   * the spacers, the sweep sees already-correct content, removes them, then re-adds
   * them next pass — measured in Chromium as `3 spacers → 0 → 3 → 0` forever, which
   * is the text visibly moving up and down.
   *
   * The extension therefore measures INTRINSIC heights (subtracting any spacer
   * between two blocks). These tests pin the property that makes that safe: the same
   * intrinsic input must always produce the same output.
   */
  const PADDING_Y = 72;

  it('produces the same spacers when re-run on unchanged intrinsic input', () => {
    const blocks = blocksFromHeights(Array.from({ length: 80 }, () => 40));
    const a = computePageLayout(blocks, PAGE, PADDING_Y).spacers;
    const b = computePageLayout(blocks, PAGE, PADDING_Y).spacers;
    const c = computePageLayout(blocks, PAGE, PADDING_Y).spacers;
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });

  it('is stable across many repeats for ragged content', () => {
    const blocks = blocksFromHeights([48, 24, 300, 24, 700, 24, 400, 24, 120, 500, 28, 40]);
    const first = computePageLayout(blocks, PAGE, PADDING_Y).spacers;
    for (let i = 0; i < 10; i++) {
      expect(computePageLayout(blocks, PAGE, PADDING_Y).spacers).toEqual(first);
    }
  });

  it('would oscillate if heights included the applied spacers', () => {
    // The failure mode, with a real case. Measuring raw offsetTop deltas folds an
    // inserted spacer into the PRECEDING block's height, which changes the answer on
    // the next pass. Measured in Chromium this alternated 7 spacers -> 0 -> 7 -> 0
    // forever: the text visibly moving up and down once past page 1.
    const OFFSET = 104; // the start offset actually measured in the browser
    const intrinsic = blocksFromHeights([40, 120, 120, 40, 53, 120, 61, 300, 120, 28, 120, 28, 61, 53, 120, 40, 40, 300, 61, 120, 120, 61, 61, 300, 40, 40, 300, 40, 120, 61, 300, 28, 300, 28, 40, 120, 28, 53, 28, 53, 61, 120, 300, 61, 300, 61, 61, 300, 120, 61, 40, 53, 28, 28, 40, 61, 40, 53, 300, 61]);

    const pass1 = computePageLayout(intrinsic, PAGE, OFFSET).spacers;
    expect(pass1.length).toBeGreaterThan(0);

    // A spacer inserted before block i sits between block i-1 and block i, so a raw
    // delta attributes it to block i-1.
    const gapByPos = new Map(pass1.map((sp) => [sp.pos, sp.height]));
    const contaminated = intrinsic.map((b, i) => {
      const nextPos = intrinsic[i + 1]?.pos;
      const gap = nextPos === undefined ? 0 : gapByPos.get(nextPos) ?? 0;
      return { ...b, height: b.height + gap };
    });

    const pass2 = computePageLayout(contaminated, PAGE, OFFSET).spacers;
    expect(pass2).not.toEqual(pass1);
  });
});
