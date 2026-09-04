import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { computePageLayout, type LayoutBlock } from './pagination-layout';
import { collectLayoutUnits, intrinsicHeights, type MeasuredRect } from './pagination-units';

export interface PaginationOptions {
  /** Usable content height per page in CSS px (page height minus margins). */
  contentAreaPx: number;
  /**
   * Distance from one page's content top to the next — the FULL page height.
   *
   * This is what leaves a real gap between pages for the running header and footer.
   * With pitch equal to `contentAreaPx` the pages butt together and a margin band
   * lands on the previous page's text.
   */
  pitchPx: number;
  /** Debounce before recomputing, so typing does not thrash layout. */
  debounceMs: number;
}

export const paginationPluginKey = new PluginKey<DecorationSet>('pagination');

/** Marks a spacer so tests and CSS can target it, and so it is never mistaken for content. */
export const PAGINATION_SPACER_ATTR = 'data-pagination-spacer';

/**
 * Keeps body text from straddling a simulated page boundary.
 *
 * ## Why decorations rather than nodes
 *
 * Spacers exist only in the view layer. They never enter the document, so
 * `editor.getHTML()` is byte-identical with and without this extension and no
 * spacer can leak into a saved template. That is the single most important
 * constraint here — the alternative (inserting real nodes) would corrupt stored
 * content, which is far worse than the cosmetic bug being fixed.
 *
 * ## Why the layout is computed in one sweep
 *
 * See `pagination-layout.ts`. Measuring, inserting, then re-measuring does not
 * converge, because each insertion invalidates everything below it. All heights are
 * read once up front and the offsets are then pure arithmetic.
 *
 * The measure pass reads `offsetHeight` per top-level block, which forces layout, so
 * it is debounced and run inside `requestAnimationFrame`.
 */
export const Pagination = Extension.create<PaginationOptions>({
  name: 'pagination',

  addOptions() {
    return {
      // Letter default: 1056px page − 2 × 72px margin.
      contentAreaPx: 912,
      pitchPx: 1056,
      debounceMs: 200,
    };
  },

  addProseMirrorPlugins() {
    const { contentAreaPx, pitchPx, debounceMs } = this.options;

    // Signature of the last computed spacer set. DecorationSet has no equality
    // method, and dispatching an identical set would re-enter the update handler
    // forever, so compare a cheap string instead.
    let lastSignature: string | null = null;

    /**
     * Measure the layout units and hand them to the pure sweep.
     *
     * ## Units, not top-level blocks
     *
     * Tables split by row and lists by item (see `pagination-units.ts`). Treating
     * a whole table as one block pushed it to the next page in one piece and left
     * a hole the size of the remaining page — visible, undeletable, and recomputed
     * on every keystroke.
     *
     * ## Heights are INTRINSIC, i.e. independent of the spacers already applied
     *
     * This is what makes the layout stable. Measuring raw top deltas reads
     * positions that already include the previous pass's spacers, so the input
     * depends on the output: the sweep sees content as already correct, removes the
     * spacers, then re-adds them next pass. Measured in Chromium, that alternated
     * `3 spacers → 0 → 3 → 0` forever — the text visibly jittering up and down.
     *
     * Subtracting any intervening spacer height recovers the height the unit would
     * have with no pagination at all, which is a fixed point: same signature on
     * every pass.
     *
     * ## Why bounding rects rather than offsetTop
     *
     * `offsetTop` is relative to the nearest positioned ancestor, and for a table
     * row that is the table, not the editor. Rects against the editor root put
     * paragraphs, rows, and list items on one axis. Spacers are located the same
     * way, so a spacer nested inside a table body is found by position rather than
     * by sibling walking.
     *
     * ## Why deltas rather than offsetHeight + margins
     *
     * Adjacent block margins COLLAPSE, so summing `marginTop + marginBottom`
     * double-counts — an h1 whose real advance was 61px computed as 85px, and the
     * accumulated error shifted every boundary.
     */
    const measure = (view: EditorView): DecorationSet => {
      const { doc } = view.state;
      const rootTop = view.dom.getBoundingClientRect().top;
      const rectOf = (el: Element): MeasuredRect => {
        const r = el.getBoundingClientRect();
        return { top: r.top - rootTop, height: r.height };
      };

      const spacerRects = Array.from(
        view.dom.querySelectorAll(`[${PAGINATION_SPACER_ATTR}]`),
      ).map(rectOf);

      interface Measured extends MeasuredRect { pos: number; isBreak: boolean }
      const measured: Measured[] = [];

      for (const unit of collectLayoutUnits(doc)) {
        const dom = view.nodeDOM(unit.measurePos);
        if (!(dom instanceof HTMLElement)) continue;
        measured.push({ ...rectOf(dom), pos: unit.spacerPos, isBreak: unit.isExplicitBreak });
      }

      if (!measured.length) return DecorationSet.empty;

      const heights = intrinsicHeights(measured, spacerRects);
      const blocks: LayoutBlock[] = measured.map((m, i) => ({
        pos: m.pos,
        height: heights[i],
        isExplicitBreak: m.isBreak,
      }));

      // The first unit's position must exclude any spacer above it too, or the
      // start offset drifts by that height on every pass.
      const first = measured[0];
      const leadingSpacer = spacerRects.reduce(
        (sum, s) => (s.top < first.top ? sum + s.height : sum),
        0,
      );
      const startOffsetPx = Math.max(0, first.top - leadingSpacer);

      const { spacers } = computePageLayout(blocks, { contentAreaPx, pitchPx, startOffsetPx });
      lastSignature = spacers.map((s) => `${s.pos}:${s.height}`).join('|');
      if (!spacers.length) return DecorationSet.empty;

      return DecorationSet.create(
        doc,
        spacers.map((spacer) =>
          Decoration.widget(
            spacer.pos,
            () => {
              const el = document.createElement('div');
              el.setAttribute(PAGINATION_SPACER_ATTR, 'true');
              el.setAttribute('aria-hidden', 'true');
              el.contentEditable = 'false';
              el.style.height = `${spacer.height}px`;
              el.style.pointerEvents = 'none';
              el.style.userSelect = 'none';
              return el;
            },
            {
              // Before the block it pushes, and invisible to selection mapping so
              // the caret can never land inside it.
              side: -1,
              ignoreSelection: true,
              marks: [],
            },
          ),
        ),
      );
    };

    return [
      new Plugin<DecorationSet>({
        key: paginationPluginKey,

        state: {
          init: () => DecorationSet.empty,
          apply: (tr, value) => {
            // The view supplies freshly measured decorations via meta, because
            // measuring needs the DOM and cannot happen in a pure reducer.
            const supplied = tr.getMeta(paginationPluginKey) as DecorationSet | undefined;
            if (supplied) return supplied;
            // Otherwise remap what we have through the document change.
            return value.map(tr.mapping, tr.doc);
          },
        },

        props: {
          decorations: (state) => paginationPluginKey.getState(state),
        },

        view: (view) => {
          let timer: ReturnType<typeof setTimeout> | null = null;
          let frame: number | null = null;
          let destroyed = false;

          const schedule = () => {
            if (destroyed) return;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              if (frame) cancelAnimationFrame(frame);
              frame = requestAnimationFrame(() => {
                if (destroyed) return;
                const previousSignature = lastSignature;
                const next = measure(view);
                // `measure` refreshes lastSignature; an unchanged layout means
                // there is nothing to dispatch, which is what stops the loop.
                if (lastSignature === previousSignature && previousSignature !== null) return;
                view.dispatch(
                  view.state.tr.setMeta(paginationPluginKey, next).setMeta('addToHistory', false),
                );
              });
            }, debounceMs);
          };

          schedule();

          return {
            update: schedule,
            destroy: () => {
              destroyed = true;
              if (timer) clearTimeout(timer);
              if (frame) cancelAnimationFrame(frame);
            },
          };
        },
      }),
    ];
  },
});
