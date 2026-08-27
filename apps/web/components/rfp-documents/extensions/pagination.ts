import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { computePageLayout, type LayoutBlock } from './pagination-layout';

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

    /** Height of any spacers currently sitting between two elements. */
    const spacerHeightBetween = (from: HTMLElement, to: HTMLElement | null): number => {
      let total = 0;
      let node = from.nextElementSibling;
      while (node && node !== to) {
        if (node instanceof HTMLElement && node.hasAttribute(PAGINATION_SPACER_ATTR)) {
          total += node.offsetHeight;
        }
        node = node.nextElementSibling;
      }
      return total;
    };

    /**
     * Measure top-level blocks and hand them to the pure sweep.
     *
     * ## Heights are INTRINSIC, i.e. independent of the spacers already applied
     *
     * This is what makes the layout stable. Measuring raw `offsetTop` deltas reads
     * positions that already include the previous pass's spacers, so the input
     * depends on the output: the sweep sees content as already correct, removes the
     * spacers, then re-adds them next pass. Measured in Chromium, that alternated
     * `3 spacers → 0 → 3 → 0` forever — the text visibly jittering up and down.
     *
     * Subtracting any intervening spacer height recovers the height the block would
     * have with no pagination at all, which is a fixed point: same signature on
     * every pass.
     *
     * ## Why deltas rather than offsetHeight + margins
     *
     * Adjacent block margins COLLAPSE, so summing `marginTop + marginBottom`
     * double-counts — an h1 whose real advance was 61px computed as 85px, and the
     * accumulated error shifted every boundary.
     */
    const measure = (view: EditorView): DecorationSet => {
      const { doc } = view.state;

      interface Measured { pos: number; dom: HTMLElement; top: number; height: number; isBreak: boolean }
      const measured: Measured[] = [];

      doc.forEach((node, offset) => {
        const dom = view.nodeDOM(offset);
        if (!(dom instanceof HTMLElement)) return;
        measured.push({
          pos: offset,
          dom,
          top: dom.offsetTop,
          height: dom.offsetHeight,
          isBreak: node.type.name === 'pageBreak',
        });
      });

      if (!measured.length) return DecorationSet.empty;

      const blocks: LayoutBlock[] = measured.map((m, i) => {
        const next = measured[i + 1];
        return {
          pos: m.pos,
          height: next
            ? Math.max(0, next.top - m.top - spacerHeightBetween(m.dom, next.dom))
            : m.height,
          isExplicitBreak: m.isBreak,
        };
      });

      // The first block's position must exclude any spacer above it too, or the
      // start offset drifts by that height on every pass.
      const first = measured[0];
      let leadingSpacer = 0;
      for (let node = first.dom.previousElementSibling; node; node = node.previousElementSibling) {
        if (node instanceof HTMLElement && node.hasAttribute(PAGINATION_SPACER_ATTR)) {
          leadingSpacer += node.offsetHeight;
        }
      }
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
