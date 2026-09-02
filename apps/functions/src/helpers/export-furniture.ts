/**
 * Shared logic for rendering page furniture (running headers and footers) into
 * exported documents.
 *
 * This module exists so PDF, DOCX and HTML exports agree. "Header and footer
 * display consistently across all generated document types" is an acceptance
 * criterion, and three independent copies of the alignment / margin / token
 * rules would drift apart on the first change.
 *
 * ## Why images need special handling
 *
 * Header/footer HTML uses the same `<img src="s3key:KEY">` convention as
 * template bodies, but neither renderer can consume that form:
 *
 * - Puppeteer's `headerTemplate` renders in an isolated context that does **not**
 *   fetch external URLs. Verified against Chromium: a `data:` URI image grows the
 *   PDF by ~22KB, while the same image behind an https URL contributes nothing.
 *   So PDF furniture images must be inlined as base64 data URIs.
 * - `export-docx.ts` explicitly skips any `src` still starting with `s3key:`
 *   (see `parseImgToParagraph`), so an unresolved key means the logo silently
 *   vanishes with no error.
 *
 * Both paths therefore resolve keys to bytes *before* rendering, and both fail
 * loudly enough to debug (a warning per key) rather than dropping images quietly.
 */

import { GetObjectCommand } from '@aws-sdk/client-s3';
import {
  resolveFurnitureVisibility,
  type PageFurniture,
  type PageFurnitureAlignment,
  type TemplateFurniture,
} from '@auto-rfp/core';
import { s3 } from './s3';
import { requireEnv } from './env';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

/** Page margin used by every export path today (`@page { margin: 1in }`). */
export const BASE_MARGIN_IN = 1;

/** Twips per inch — DOCX measures page margins in twentieths of a point. */
export const TWIPS_PER_INCH = 1440;

export const ALIGNMENT_TO_CSS: Record<PageFurnitureAlignment, string> = {
  LEFT: 'left',
  CENTER: 'center',
  RIGHT: 'right',
};

/**
 * Grow a page margin to reserve room for furniture.
 *
 * Without this the furniture is drawn into the same inch of paper as the body
 * text and the two overprint. Chromium does not reflow content to avoid it.
 */
export const marginForFurniture = (
  furniture: TemplateFurniture | undefined,
  visible: { showHeader: boolean; showFooter: boolean },
): { topIn: number; bottomIn: number } => ({
  topIn: BASE_MARGIN_IN + (visible.showHeader ? (furniture?.header.heightIn ?? 0) : 0),
  bottomIn: BASE_MARGIN_IN + (visible.showFooter ? (furniture?.footer.heightIn ?? 0) : 0),
});

/**
 * True when any section suppresses furniture that another section shows.
 *
 * Callers use this to decide whether the cheap uniform render is sufficient.
 */
export const hasSectionOverrides = (furniture: TemplateFurniture | undefined): boolean =>
  !!furniture?.sectionOverrides.some((o) => o.showHeader === false || o.showFooter === false);

// ─── Image resolution ─────────────────────────────────────────────────────────

const IMG_S3_KEY_RE = /src="s3key:([^"]+)"/g;

/** Map a key's extension to a MIME type. SVG is excluded: DOCX cannot embed it. */
const mimeForKey = (key: string): string | null => {
  const ext = key.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':  return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif':  return 'image/gif';
    case 'bmp':  return 'image/bmp';
    default:     return null;
  }
};

const streamToBuffer = async (body: unknown): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  const stream = body as AsyncIterable<Uint8Array>;
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
};

/** Collect every distinct `s3key:` image reference in the given HTML fragments. */
export const collectFurnitureImageKeys = (...htmlParts: readonly string[]): string[] => {
  const keys = new Set<string>();
  for (const html of htmlParts) {
    if (!html) continue;
    for (const m of html.matchAll(IMG_S3_KEY_RE)) keys.add(m[1]);
  }
  return [...keys];
};

/**
 * Replace `src="s3key:KEY"` with inline base64 data URIs.
 *
 * Used by the PDF path, where external URLs are never fetched. Fetches run in
 * parallel — a header logo is on every page, so this is on the hot path.
 * A key that cannot be fetched keeps its placeholder so the failure is visible
 * in the output rather than silently rendering a blank box.
 */
export const inlineFurnitureImages = async (html: string): Promise<string> => {
  const keys = collectFurnitureImageKeys(html);
  if (!keys.length) return html;

  const dataUris = new Map<string, string>();
  await Promise.all(
    keys.map(async (key) => {
      const mime = mimeForKey(key);
      if (!mime) {
        console.warn(`Furniture image has unsupported type, skipping: ${key}`);
        return;
      }
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: key }));
        const buf = await streamToBuffer(res.Body);
        dataUris.set(key, `data:${mime};base64,${buf.toString('base64')}`);
      } catch (err) {
        console.warn(`Failed to inline furniture image ${key}:`, (err as Error)?.message);
      }
    }),
  );

  return html.replace(IMG_S3_KEY_RE, (whole, key: string) => {
    const uri = dataUris.get(key);
    return uri ? `src="${uri}"` : whole;
  });
};

// ─── Token substitution ───────────────────────────────────────────────────────

/**
 * Swap `{{PAGE_NUMBER}}` / `{{TOTAL_PAGES}}` for Puppeteer's magic spans.
 *
 * Puppeteer substitutes the `pageNumber` / `totalPages` classes per page while
 * printing, which is the only way to get a correct running count — the value is
 * unknowable before pagination.
 */
export const applyPdfPageTokens = (html: string): string =>
  html
    .replace(/\{\{PAGE_NUMBER\}\}/g, '<span class="pageNumber"></span>')
    .replace(/\{\{TOTAL_PAGES\}\}/g, '<span class="totalPages"></span>');

// ─── PDF templates ────────────────────────────────────────────────────────────

/**
 * Wrap furniture HTML in the container Puppeteer expects.
 *
 * Puppeteer-specific traps handled here, all confirmed by inspecting rendered PDFs:
 * 1. The default font-size inside header/footer templates is ~6pt, effectively
 *    unreadable, so an explicit size is mandatory.
 * 2. The template is laid out edge-to-edge, ignoring the page margin, so the
 *    horizontal inset has to be reapplied to line furniture up with the body.
 *    It must be `padding`, not `margin`: with `width: 100%` a margin pushes the
 *    box wider than the page, which shifted centred content off to the left.
 * 3. An `<img>` is baseline-aligned by default, so a logo sat above the text it
 *    was next to, with no gap. Inline children are centred as a flex row and
 *    images are middle-aligned and height-capped to the band.
 * 4. Block children (`<p>`) inside a flex row would each become their own line;
 *    they are reset to inline so "logo + name" reads as one line.
 */
const wrapPdfTemplate = (
  innerHtml: string,
  align: PageFurnitureAlignment,
  heightIn: number,
): string => {
  const maxImgPx = Math.max(8, Math.round(heightIn * 96));
  // Plain inline flow + `text-align`, not flexbox: a flex container treats the
  // injected <style> element as a flex item, which knocked the real content off
  // centre. Inline content honours `text-align` on the parent exactly.
  return `<div style="
  -webkit-print-color-adjust: exact;
  box-sizing: border-box;
  width: 100%;
  padding: 0 ${BASE_MARGIN_IN}in;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  font-size: 9pt;
  line-height: 1.3;
  color: #6b7280;
  text-align: ${ALIGNMENT_TO_CSS[align]};
"><style>
  .furniture-inline p, .furniture-inline div, .furniture-inline h1, .furniture-inline h2,
  .furniture-inline h3, .furniture-inline h4 { display: inline; margin: 0; padding: 0; font-size: inherit; font-weight: inherit; }
  .furniture-inline img { max-height: ${maxImgPx}px; width: auto; vertical-align: middle; margin: 0 6px 0 0; }
</style><span class="furniture-inline">${innerHtml}</span></div>`;
};

/** Puppeteer renders its built-in furniture unless given an explicit empty template. */
export const EMPTY_PDF_TEMPLATE = '<div></div>';

/**
 * Build the `headerTemplate` / `footerTemplate` pair for a `page.pdf()` call.
 *
 * Images are inlined here because this is the only PDF route that renders them —
 * `@page` margin boxes ignore `content: url(...)` entirely.
 */
export const buildPdfFurnitureTemplates = async (
  furniture: TemplateFurniture | undefined,
  visible: { showHeader: boolean; showFooter: boolean },
): Promise<{ headerTemplate: string; footerTemplate: string }> => {
  const render = async (part: PageFurniture | undefined, show: boolean): Promise<string> => {
    if (!show || !part) return EMPTY_PDF_TEMPLATE;
    const withImages = await inlineFurnitureImages(part.html);
    return wrapPdfTemplate(applyPdfPageTokens(withImages), part.align, part.heightIn);
  };

  return {
    headerTemplate: await render(furniture?.header, visible.showHeader),
    footerTemplate: await render(furniture?.footer, visible.showFooter),
  };
};

// ─── Named-page CSS (per-section suppression) ─────────────────────────────────

/**
 * Named-page CSS is NOT used to suppress PDF furniture.
 *
 * Measured against Chromium: `@page name { @top-center { content: none } }` has
 * **no effect** on Puppeteer's `headerTemplate` — output is byte-for-byte
 * identical with and without the rules. The two mechanisms are independent, and
 * only `headerTemplate` renders images, so it is the one that carries furniture.
 *
 * Emitting the rules anyway also caused real damage: assigning a named page to a
 * section element forced an extra page break, turning a 3-page document into 4.
 *
 * Per-section suppression is therefore done by rendering page ranges separately
 * and merging them — see `renderPdfWithSectionFurniture` in `export-pdf.ts`.
 * This function is retained, returning nothing, to keep the HTML export path
 * free of dead conditionals.
 */
export const buildFurnitureSectionCss = (_furniture: TemplateFurniture | undefined): string => '';

// ─── Section splitting ────────────────────────────────────────────────────────

/**
 * Split body HTML on explicit page breaks into furniture sections.
 *
 * A "section" is the unit that per-section toggles address. Breaks are the same
 * markers the TipTap PageBreak node emits (`data-page-break`) plus the legacy
 * `.page-break-node` class, matching what `export-pdf`/`export-docx` already
 * recognise.
 *
 * Returns at least one section so callers never special-case empty input.
 */
export const PAGE_BREAK_SPLIT_RE =
  /<div[^>]*(?:data-page-break|class="[^"]*page-break-node[^"]*")[^>]*>(?:\s*<\/div>)?/gi;

export const splitIntoFurnitureSections = (html: string): string[] => {
  const parts = html.split(PAGE_BREAK_SPLIT_RE);
  const sections = parts.map((p) => p ?? '');
  return sections.length ? sections : [''];
};

/**
 * Resolve visibility for every section in a document.
 *
 * Thin wrapper over the core rule so renderers share one implementation.
 */
export const resolveSectionVisibilities = (
  furniture: TemplateFurniture | undefined,
  sectionCount: number,
): Array<{ showHeader: boolean; showFooter: boolean }> =>
  Array.from({ length: Math.max(1, sectionCount) }, (_, i) =>
    resolveFurnitureVisibility(furniture, i),
  );

/**
 * Group consecutive sections that share the same furniture visibility.
 *
 * Each run becomes one `page.pdf()` pass, because `headerTemplate` is fixed for a
 * whole render. Grouping keeps the number of passes to the number of *distinct*
 * furniture states — usually two (cover, then everything else) rather than one
 * pass per section.
 */
export const groupSectionsByVisibility = (
  visibilities: ReadonlyArray<{ showHeader: boolean; showFooter: boolean }>,
): Array<{ startSection: number; endSection: number; showHeader: boolean; showFooter: boolean }> => {
  const runs: Array<{ startSection: number; endSection: number; showHeader: boolean; showFooter: boolean }> = [];

  for (let i = 0; i < visibilities.length; i++) {
    const v = visibilities[i];
    const last = runs[runs.length - 1];
    if (last && last.showHeader === v.showHeader && last.showFooter === v.showFooter) {
      last.endSection = i;
    } else {
      runs.push({ startSection: i, endSection: i, showHeader: v.showHeader, showFooter: v.showFooter });
    }
  }

  return runs;
};

/**
 * Script evaluated in the page to find which PDF page each section starts on.
 *
 * Measured with `getBoundingClientRect` relative to the document, not
 * `offsetTop`: the section markers are zero-height and their nearest positioned
 * ancestor is `body`, so `offsetTop` reported 0 for every one of them and every
 * section appeared to start on page 1.
 *
 * Explicit page breaks are the authoritative signal — each one advances to the
 * next page regardless of how full the current page is — so pagination is
 * reconstructed by walking the breaks and only then falling back to measured
 * height for natural overflow.
 */
export const buildSectionPageMapScript = (pageContentHeightPx: number): string => `
(function() {
  var pageHeight = ${pageContentHeightPx};
  var docTop = document.documentElement.getBoundingClientRect().top;
  function absTop(el) { return el.getBoundingClientRect().top - docTop; }

  var breaks = [];
  var breakEls = document.querySelectorAll('[data-page-break], .page-break-node');
  for (var b = 0; b < breakEls.length; b++) breaks.push(absTop(breakEls[b]));
  breaks.sort(function(a, b) { return a - b; });

  // Page for a position: one page per preceding explicit break, plus any pages
  // gained by natural overflow since that break.
  function pageFor(top) {
    var page = 1;
    var lastBreakTop = 0;
    for (var i = 0; i < breaks.length; i++) {
      if (breaks[i] > top + 1) break;
      page++;
      lastBreakTop = breaks[i];
    }
    var since = top - lastBreakTop;
    if (since > 0 && pageHeight > 0) page += Math.floor(since / pageHeight);
    return page;
  }

  var els = document.querySelectorAll('[data-furniture-section]');
  var out = [];
  for (var i = 0; i < els.length; i++) {
    var idx = parseInt(els[i].getAttribute('data-furniture-section'), 10);
    out.push({ section: idx, page: pageFor(absTop(els[i])) });
  }
  return JSON.stringify(out);
})()`;

/** Content area height per page in CSS px at 96 DPI, given the vertical margins. */
export const pageContentHeightPx = (
  pageSize: 'letter' | 'a4',
  topIn: number,
  bottomIn: number,
): number => {
  const pageHeightIn = pageSize === 'a4' ? 297 / 25.4 : 11;
  return Math.max(1, Math.round((pageHeightIn - topIn - bottomIn) * 96));
};
