/**
 * Ephemeral, export-safe highlighting inside the RFP document editor.
 *
 * These helpers only mutate the live DOM (scroll + a temporary CSS outline / a
 * transient <span> wrapper that is removed after a delay). They NEVER write to
 * the persisted document HTML, so export — which reads the saved S3 HTML — is
 * unaffected. Extracted from the existing scroll-to-heading routine in
 * opportunity-document-editor-page.tsx so compliance-review findings can reuse it.
 */

const EDITOR_SELECTOR = '.tiptap-document-editor .ProseMirror';
const HIGHLIGHT_MS = 2000;

const findScrollContainer = (el: HTMLElement): HTMLElement | null => {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
};

const scrollTo = (el: HTMLElement): void => {
  const container = findScrollContainer(el);
  if (!container) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    return;
  }
  const elRect = el.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const offset = elRect.top - containerRect.top + container.scrollTop - 20;
  container.scrollTo({ top: offset, behavior: 'smooth' });
};

const flashOutline = (el: HTMLElement): void => {
  el.style.outline = '2px solid var(--primary)';
  el.style.outlineOffset = '4px';
  el.style.borderRadius = '4px';
  setTimeout(() => {
    el.style.outline = '';
    el.style.outlineOffset = '';
    el.style.borderRadius = '';
  }, HIGHLIGHT_MS);
};

/** Scroll to + flash the heading whose text matches `sectionTitle`. Returns true on match. */
export const highlightSectionByHeading = (sectionTitle: string): boolean => {
  const editor = document.querySelector(EDITOR_SELECTOR);
  if (!editor) return false;
  const target = sectionTitle.trim().toLowerCase();
  const headings = Array.from(editor.querySelectorAll('h1, h2, h3'));
  for (const heading of headings) {
    if (heading.textContent?.trim().toLowerCase() === target) {
      scrollTo(heading as HTMLElement);
      flashOutline(heading as HTMLElement);
      return true;
    }
  }
  return false;
};

/**
 * Active snippet search: find the first text node containing `snippet`, scroll
 * to its element, and flash it. Fallback when a heading anchor didn't match.
 * Returns true on match.
 */
export const highlightBySnippet = (snippet: string): boolean => {
  const editor = document.querySelector(EDITOR_SELECTOR);
  if (!editor) return false;
  const needle = snippet.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!needle) return false;

  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const text = (node.textContent ?? '').toLowerCase().replace(/\s+/g, ' ');
    if (text.includes(needle)) {
      const el = node.parentElement;
      if (el) {
        scrollTo(el);
        flashOutline(el);
        return true;
      }
    }
  }
  return false;
};

/**
 * Best-effort highlight from URL params: try the heading anchor first, then the
 * snippet. Call once the editor DOM is ready (after a small delay for remount).
 */
export const highlightFromParams = (params: {
  highlightSection?: string | null;
  findSnippet?: string | null;
}): void => {
  if (params.highlightSection && highlightSectionByHeading(params.highlightSection)) return;
  if (params.findSnippet) highlightBySnippet(params.findSnippet);
};
