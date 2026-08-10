import DOMPurify from 'dompurify';

/** Matches `src="s3key:KEY"` — the placeholder form stored in template HTML. */
export const S3_KEY_SRC_RE = /src="s3key:([^"]+)"/g;

/** Matches an `<img>` whose src is still an unresolved s3key placeholder. */
const IMG_WITH_S3_KEY_RE = /<img\b[^>]*src="s3key:([^"]+)"[^>]*>/g;

/** Matches a macro token, e.g. `{{COMPANY_NAME}}`. */
const MACRO_RE = /\{\{(\w+)\}\}/g;

/** Tokens the renderer resolves per page, so no fixed value can be shown. */
const PAGE_TOKEN_LABELS: Record<string, string> = {
  PAGE_NUMBER: '#',
  TOTAL_PAGES: '##',
};

/** `COMPANY_NAME` → `COMPANY NAME`, for a readable chip. */
const humanizeToken = (token: string): string => token.replace(/_/g, ' ');

/** Collect every distinct s3 key referenced by the given HTML. */
export const collectS3Keys = (html: string): string[] => {
  const found = new Set<string>();
  for (const match of html.matchAll(S3_KEY_SRC_RE)) found.add(match[1]);
  return [...found];
};

export interface RenderBandOptions {
  /** Resolved key → viewable URL. */
  resolved: Record<string, string>;
  /** Keys whose resolution failed. */
  failedKeys?: Record<string, true>;
  /**
   * Actual page numbers to substitute for the page tokens. When omitted the
   * tokens render as `‹#›`/`‹##›` chips instead — used where no page context
   * exists (the sidebar strip previews a band, not a specific page).
   */
  pageNumbers?: { current: number; total: number };
}

/**
 * Turn stored furniture HTML into display-ready HTML.
 *
 * Shared by the sidebar preview strip and the in-canvas page overlay so the two
 * cannot drift — a preview that disagrees with what the user sees on the page
 * would be worse than no preview at all.
 *
 * Two invariants, both load-bearing:
 *
 * 1. **Display only.** The returned HTML is never written back to state. Stored
 *    content must keep its `s3key:` placeholders, or saved templates would carry
 *    presigned URLs that expire.
 * 2. **Sanitised first.** The content is user-authored and reaches the DOM via
 *    `dangerouslySetInnerHTML`. Chips and stubs are injected afterwards, as
 *    text-only spans, so they cannot introduce markup.
 */
export const renderFurnitureBandHtml = (
  html: string,
  { resolved, failedKeys = {}, pageNumbers }: RenderBandOptions,
): string => {
  const safe = DOMPurify.sanitize(html);

  // An unresolved image must NOT keep an empty `src` — browsers draw that as their
  // broken-image glyph, which reads as an error rather than a pending state.
  const withImages = safe.replace(IMG_WITH_S3_KEY_RE, (whole, key: string) => {
    const url = resolved[key];
    if (url) return whole.replace(`src="s3key:${key}"`, `src="${url}"`);
    const failed = !!failedKeys[key];
    return `<span class="furniture-img-stub" data-state="${failed ? 'failed' : 'loading'}" title="${
      failed ? 'Image could not be loaded' : 'Loading image…'
    }">${failed ? 'image unavailable' : 'image…'}</span>`;
  });

  return withImages.replace(MACRO_RE, (_whole, token: string) => {
    // With a page context, page tokens show the real number — that is what makes
    // the in-canvas overlay read like Word rather than like a template.
    if (pageNumbers && token === 'PAGE_NUMBER') return String(pageNumbers.current);
    if (pageNumbers && token === 'TOTAL_PAGES') return String(pageNumbers.total);

    const label = PAGE_TOKEN_LABELS[token] ?? humanizeToken(token);
    return `<span class="furniture-chip" data-macro="${token}">‹${label}›</span>`;
  });
};
