/**
 * Ephemeral DOM highlight primitives shared by the compliance-review deep-link
 * highlighters (HTML rich-text editor + XLSX/PDF form editors).
 *
 * These ONLY mutate the live DOM (scroll + a temporary CSS outline that is
 * removed after a delay). They NEVER write to persisted content, so export —
 * which reads saved S3 HTML / form fields, not live editor state — is unaffected.
 */

const HIGHLIGHT_MS = 4000;

/** Walk up to the nearest scrollable ancestor, or null if none before <body>. */
const findScrollContainer = (el: HTMLElement): HTMLElement | null => {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (style.overflowY === 'auto' || style.overflowY === 'scroll') return node;
    node = node.parentElement;
  }
  return null;
};

/** Smooth-scroll `el` into view within its scroll container (or the viewport). */
export const scrollToElement = (el: HTMLElement): void => {
  const container = findScrollContainer(el);
  if (!container) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  const elRect = el.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  const offset = elRect.top - containerRect.top + container.scrollTop - 20;
  container.scrollTo({ top: offset, behavior: 'smooth' });
};

/**
 * Flash a transient highlight on `el`. Works for both block elements (headings)
 * and cells/fields in a dense grid.
 *
 * Rather than style `el` itself (styling ProseMirror-managed nodes or dense
 * `<td>`s kept losing to the cascade / getting stripped on re-render / being
 * zeroed by prefers-reduced-motion), we draw a SEPARATE overlay box on top of
 * the target: a fixed-position div appended to <body> with its own inline styles
 * and a very high z-index. Nothing in the app's CSS or the editor can override
 * or strip it. A requestAnimationFrame loop keeps it aligned to the target
 * (through smooth scroll and editor re-renders) for HIGHLIGHT_MS, then removes it.
 */
export const flashHighlight = (el: HTMLElement): void => {
  if (typeof document === 'undefined') return;

  const overlay = document.createElement('div');
  overlay.setAttribute('data-compliance-highlight', '');
  overlay.style.position = 'fixed';
  overlay.style.zIndex = '2147483647';
  overlay.style.pointerEvents = 'none';
  overlay.style.boxSizing = 'border-box';
  overlay.style.border = '2px solid rgb(245, 158, 11)'; // amber-500
  overlay.style.background = 'rgba(250, 204, 21, 0.35)'; // amber-400 wash
  overlay.style.borderRadius = '3px';
  overlay.style.transition = 'opacity 0.4s ease-out';
  overlay.style.opacity = '1';
  document.body.appendChild(overlay);

  const sync = (): boolean => {
    if (!document.contains(el)) return false;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    overlay.style.top = `${r.top - 2}px`;
    overlay.style.left = `${r.left - 2}px`;
    overlay.style.width = `${r.width + 4}px`;
    overlay.style.height = `${r.height + 4}px`;
    return true;
  };
  sync();

  const start = performance.now();
  let rafId = 0;
  const step = (now: number) => {
    const alive = sync();
    if (!alive || now - start >= HIGHLIGHT_MS) {
      // Fade out, then remove.
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 450);
      return;
    }
    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);
  // Safety: guarantee cleanup even if rAF is throttled (tab backgrounded).
  setTimeout(() => {
    cancelAnimationFrame(rafId);
    overlay.remove();
  }, HIGHLIGHT_MS + 1000);
};

/** Scroll to + flash `el`. */
export const scrollToAndFlash = (el: HTMLElement): void => {
  scrollToElement(el);
  flashHighlight(el);
};

/** Scroll to + flash `el` (alias kept for the form highlighters). */
export const scrollToAndFlashCell = (el: HTMLElement): void => {
  scrollToElement(el);
  flashHighlight(el);
};

/** Normalize text for tolerant substring matching (lowercase, collapse whitespace). */
export const normalizeForMatch = (text: string): string =>
  text.trim().toLowerCase().replace(/\s+/g, ' ');
