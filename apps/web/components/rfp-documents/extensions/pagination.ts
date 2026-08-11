import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { EditorView } from '@tiptap/pm/view';
import { computePageLayout, type LayoutBlock } from './pagination-layout';

export interface PaginationOptions {
  /** Usable content height per page in CSS px (page height minus margins). */
  contentAreaPx: number;
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
      debounceMs: 200,
    };
  },

  addProseMirrorPlugins() {
    const { contentAreaPx, debounceMs } = this.options;

    // Signature of the last computed spacer set. DecorationSet has no equality
    // method, and dispatching an identical set would re-enter the update handler
    // forever, so compare a cheap string instead.
    let lastSignature: string | null = null;

    /**
     * Measure top-level blocks and hand them to the pure sweep.
     *
     * Heights come from `offsetTop` DELTAS rather than
     * `offsetHeight + marginTop + marginBottom`. Adjacent block margins COLLAPSE,
     * so summing them double-counts: measured in Chromium, an h1 whose real advance
     * was 61px computed as 85px, and the accumulated error silently shifted every
     * boundary. Deltas are what the layout actually did.
     *
     * Offsets are normalised so the first block starts at the container's padding —
     * the same origin the page-sheet grid uses.
     */
    const measure = (view: EditorView): DecorationSet => {
      const { doc } = view.state;

      interface Measured { pos: number; top: number; height: number; isBreak: boolean }
      const measured: Measured[] = [];

      doc.forEach((node, offset) => {
        const dom = view.nodeDOM(offset);
        if (!(dom instanceof HTMLElement)) return;
        measured.push({
          pos: offset,
          top: dom.offsetTop,
          height: dom.offsetHeight,
          isBreak: node.type.name === 'pageBreak',
        });
      });

      if (!measured.length) return DecorationSet.empty;

      // Height = distance to the next block's top, which absorbs collapsed margins
      // exactly as the browser laid them out. The last block has no successor, so
      // fall back to its own box height.
      const blocks: LayoutBlock[] = measured.map((m, i) => {
        const next = measured[i + 1];
        return {
          pos: m.pos,
          height: next ? Math.max(0, next.top - m.top) : m.height,
          isExplicitBreak: m.isBreak,
        };
      });

      // The page grid starts at 0 at the top of the padded container, so the first
      // block's own offsetTop is the starting offset.
      const startOffsetPx = measured[0].top;

      const { spacers } = computePageLayout(blocks, contentAreaPx, startOffsetPx);
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
