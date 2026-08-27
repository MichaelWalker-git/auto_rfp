/**
 * Scheme-checking for URLs that reach an anchor's `href`.
 *
 * A `href` is an execution sink: `javascript:alert(1)` in an `href` runs on click, in the
 * origin of whoever clicked. Every URL this app renders comes from somewhere outside it —
 * an agency contact typed by an org member, a portal address resolved from a records
 * directory, a listing URL echoed back by the HigherGov API — so none of them can be
 * trusted to be `http(s)`.
 *
 * Zod's `.url()` does NOT cover this. Verified against the installed zod 3.25:
 * `z.string().url()` accepts `javascript:alert(document.cookie)`, `data:text/html,...`
 * and `vbscript:...`, because it validates URL *syntax* rather than scheme. Fields
 * already declared `z.string().url()` are therefore still unsafe in an `href`, which is
 * exactly the trap this helper exists to close.
 */

/**
 * The only two schemes safe to put in an `href`.
 *
 * `mailto:` and `tel:` are deliberately excluded — this is for link targets, and a
 * component wanting a mail link should build `mailto:${email}` itself rather than
 * accepting whatever scheme a stored value happens to carry.
 */
const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Returns the URL when it is safe to use as a link target, otherwise null.
 *
 * Parsed with `URL` rather than matched with a regex, because a regex on the raw string
 * is defeated by the things browsers tolerate: leading whitespace and control characters
 * (`\njavascript:…`), and mixed case (`JaVaScRiPt:`). `URL` normalises both before the
 * protocol is read.
 *
 * @returns the original string (unmodified, so display and navigation agree), or null
 *          when the value is absent, unparseable, or carries a non-http(s) scheme.
 */
export const safeExternalUrl = (url: string | null | undefined): string | null => {
  if (!url) return null;

  const trimmed = url.trim();
  if (!trimmed) return null;

  try {
    // Protocol-relative and relative URLs have no scheme of their own, so they need a
    // base to parse at all. Using the current origin means a relative path stays usable
    // and cannot smuggle in a scheme.
    const base = typeof window === 'undefined' ? 'https://localhost' : window.location.href;
    const { protocol } = new URL(trimmed, base);

    return SAFE_PROTOCOLS.has(protocol) ? trimmed : null;
  } catch {
    // Unparseable is not safe.
    return null;
  }
};
