/**
 * Ephemeral DOM highlight primitives shared by the compliance-review deep-link
 * highlighters (HTML rich-text editor + XLSX/PDF form editors).
 *
 * These ONLY mutate the live DOM (scroll + a temporary CSS outline that is
 * removed after a delay). They NEVER write to persisted content, so export —
 * which reads saved S3 HTML / form fields, not live editor state — is unaffected.
 */

/**
 * Safety backstop only — NOT the primary dismissal. The highlight is meant to
 * stay until the user's next click (see flashHighlight). This long cap just
 * guarantees the overlay can never leak forever if the dismiss click is somehow
 * never delivered (e.g. a backgrounded tab where rAF is throttled and the target
 * never detaches).
 */
const HIGHLIGHT_MAX_MS = 30000;

const isScrollable = (value: string): boolean => value === 'auto' || value === 'scroll';

/**
 * Walk up to the nearest scrollable ancestor, tracking each axis independently.
 * A dense grid (XLSX) lives in a container that scrolls BOTH ways, and the target
 * cell can be off-screen horizontally as well as vertically — so we resolve a
 * separate container per axis (they're usually the same node, but need not be).
 */
const findScrollContainers = (
  el: HTMLElement,
): { vertical: HTMLElement | null; horizontal: HTMLElement | null } => {
  let vertical: HTMLElement | null = null;
  let horizontal: HTMLElement | null = null;
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const style = window.getComputedStyle(node);
    if (!vertical && isScrollable(style.overflowY) && node.scrollHeight > node.clientHeight) {
      vertical = node;
    }
    if (!horizontal && isScrollable(style.overflowX) && node.scrollWidth > node.clientWidth) {
      horizontal = node;
    }
    if (vertical && horizontal) break;
    node = node.parentElement;
  }
  return { vertical, horizontal };
};

/**
 * Smooth-scroll `el` into view within its scroll container(s), on BOTH axes.
 * Falls back to the native centering scroll when no scrollable ancestor exists
 * (e.g. a heading in the page-level flow, where only vertical matters).
 */
export const scrollToElement = (el: HTMLElement): void => {
  const { vertical, horizontal } = findScrollContainers(el);

  if (!vertical && !horizontal) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const elRect = el.getBoundingClientRect();

  if (vertical) {
    const containerRect = vertical.getBoundingClientRect();
    const top = elRect.top - containerRect.top + vertical.scrollTop - 20;
    vertical.scrollTo({ top, behavior: 'smooth' });
  }
  if (horizontal) {
    const containerRect = horizontal.getBoundingClientRect();
    const left = elRect.left - containerRect.left + horizontal.scrollLeft - 20;
    horizontal.scrollTo({ left, behavior: 'smooth' });
  }
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
  let safetyTimer = 0;
  let dismissed = false;

  // Fade out, then remove — and tear down every listener/timer/loop exactly once.
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    cancelAnimationFrame(rafId);
    clearTimeout(safetyTimer);
    document.removeEventListener('pointerdown', onPointerDown, true);
    overlay.style.opacity = '0';
    setTimeout(() => overlay.remove(), 450);
  };

  // Primary dismissal: the user's next click/tap OUTSIDE the highlighted target.
  // A click on the target itself (or its descendants) is kept, so after scrolling
  // to a possibly off-screen cell the user can read/click into it without losing
  // the highlight — only a click elsewhere clears it. The overlay has
  // pointer-events:none, so clicks pass through to the target underneath, letting
  // us test containment against the real element. Captured on the document so it
  // fires wherever the click lands. flashHighlight is always called from a
  // timeout/poll well after the triggering "Go to spot" click, so that click
  // never self-dismisses.
  function onPointerDown(event: PointerEvent) {
    const target = event.target as Node | null;
    // Keep the highlight when the click is on the highlighted element itself.
    if (target && (el === target || el.contains(target))) return;
    dismiss();
  }
  document.addEventListener('pointerdown', onPointerDown, true);

  const step = (now: number) => {
    // Keep the overlay glued to the target through scroll / editor re-renders.
    // Stop (and clean up) if the target leaves the DOM — there's nothing left to
    // point at, so the highlight has served its purpose.
    if (!sync()) {
      dismiss();
      return;
    }
    // Long backstop only — the click above is the real dismissal. This guarantees
    // the overlay can't leak forever if the dismiss click is never delivered.
    if (now - start >= HIGHLIGHT_MAX_MS) {
      dismiss();
      return;
    }
    rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);

  // Safety: guarantee cleanup even if rAF is throttled (tab backgrounded) so the
  // step loop's own backstop never runs.
  safetyTimer = window.setTimeout(dismiss, HIGHLIGHT_MAX_MS + 1000);
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
