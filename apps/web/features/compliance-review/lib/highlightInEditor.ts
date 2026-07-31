/**
 * Ephemeral, export-safe highlighting inside the RFP document editor.
 *
 * These helpers only mutate the live DOM (scroll + a temporary CSS outline).
 * They NEVER write to the persisted document HTML, so export — which reads the
 * saved S3 HTML — is unaffected. The scroll/flash primitives live in
 * domHighlight.ts and are shared with the XLSX/PDF form highlighters.
 *
 * NOTE on timing: the TipTap editor re-renders for a short window after mount
 * (content init, image-URL resolution), detaching and replacing heading/paragraph
 * nodes. Flashing on a single fixed delay lands on a node that is then destroyed
 * (its scroll never completes and the outline disappears with the node). So
 * `highlightFromParams` polls: it re-resolves the live target each attempt and
 * only settles once the same node survives two consecutive polls.
 */

import { scrollToAndFlash, normalizeForMatch } from './domHighlight';

const EDITOR_SELECTOR = '.tiptap-document-editor .ProseMirror';

/** Find the heading element whose text matches `sectionTitle` (or null). */
const findHeading = (sectionTitle: string): HTMLElement | null => {
  const editor = document.querySelector(EDITOR_SELECTOR);
  if (!editor) return null;
  const target = sectionTitle.trim().toLowerCase();
  const headings = Array.from(editor.querySelectorAll('h1, h2, h3'));
  for (const heading of headings) {
    if (heading.textContent?.trim().toLowerCase() === target) return heading as HTMLElement;
  }
  return null;
};

/** Find the first element containing `snippet` as text (or null). */
const findSnippetEl = (snippet: string): HTMLElement | null => {
  const editor = document.querySelector(EDITOR_SELECTOR);
  if (!editor) return null;
  const needle = normalizeForMatch(snippet);
  if (!needle) return null;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = normalizeForMatch(node.textContent ?? '');
    if (text.includes(needle)) return node.parentElement;
  }
  return null;
};

/** Scroll to + flash the heading whose text matches `sectionTitle`. Returns true on match. */
export const highlightSectionByHeading = (sectionTitle: string): boolean => {
  const el = findHeading(sectionTitle);
  if (!el) return false;
  scrollToAndFlash(el);
  return true;
};

/**
 * Active snippet search: find the first element containing `snippet`, scroll to
 * it, and flash it. Fallback when a heading anchor didn't match. Returns true on match.
 */
export const highlightBySnippet = (snippet: string): boolean => {
  const el = findSnippetEl(snippet);
  if (!el) return false;
  scrollToAndFlash(el);
  return true;
};

/**
 * Best-effort highlight from URL params: try the heading anchor first, then the
 * snippet. Polls until the target node is stable (the editor stops re-rendering)
 * so we flash a node that actually stays on screen, then stops.
 */
export const highlightFromParams = (params: {
  highlightSection?: string | null;
  findSnippet?: string | null;
}): void => {
  const { highlightSection, findSnippet } = params;
  if (!highlightSection && !findSnippet) return;

  const resolve = (): HTMLElement | null =>
    (highlightSection ? findHeading(highlightSection) : null) ??
    (findSnippet ? findSnippetEl(findSnippet) : null);

  const POLL_MS = 150;
  const MAX_ATTEMPTS = 40; // ~6s of settling headroom
  let attempts = 0;
  let lastEl: HTMLElement | null = null;
  let stableCount = 0;

  const tick = () => {
    attempts += 1;
    const el = resolve();

    if (el && el === lastEl && document.contains(el)) {
      // Same live node as last poll → the editor has settled. Flash and stop.
      stableCount += 1;
      if (stableCount >= 1) {
        scrollToAndFlash(el);
        return;
      }
    } else {
      stableCount = 0;
    }
    lastEl = el;

    if (attempts < MAX_ATTEMPTS) {
      setTimeout(tick, POLL_MS);
    } else if (el) {
      // Give up waiting for perfect stability — flash whatever we last found.
      scrollToAndFlash(el);
    }
  };

  tick();
};
