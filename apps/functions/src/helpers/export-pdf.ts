/**
 * Server-side HTML → PDF conversion using Puppeteer + Lambda-compatible Chromium.
 *
 * Renders the styled HTML in a headless browser and prints to PDF,
 * producing output that is pixel-identical to the rendered HTML.
 *
 * Uses a two-pass approach for accurate TOC page numbers:
 * 1. First pass: render with placeholder page numbers, generate temp PDF
 * 2. Count pages, measure actual DOM positions to calculate real page numbers
 * 3. Second pass: inject real page numbers and generate final PDF
 */

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import type { Browser, PDFOptions } from 'puppeteer-core';
import { PDFDocument } from 'pdf-lib';
import type { TemplateFurniture } from '@auto-rfp/core';
import { buildExportHtml, type BuildExportHtmlOptions } from './export-html-builder';
import {
  buildPdfFurnitureTemplates,
  buildSectionPageMapScript,
  EMPTY_PDF_TEMPLATE,
  groupSectionsByVisibility,
  marginForFurniture,
  pageContentHeightPx,
  resolveSectionVisibilities,
  splitIntoFurnitureSections,
} from './export-furniture';

export interface HtmlToPdfOptions extends BuildExportHtmlOptions {
  /** Whether to print background graphics (default: true) */
  printBackground?: boolean;
}

/**
 * Count pages in a PDF buffer by scanning for /Type /Page markers.
 */
const countPdfPages = (pdfBuffer: Buffer): number => {
  const pdfStr = pdfBuffer.toString('latin1');
  const matches = pdfStr.match(/\/Type\s*\/Page(?!\s*s)/g);
  return matches ? matches.length : 1;
};

/**
 * Build the JavaScript that runs inside Puppeteer to calculate real page numbers
 * for TOC entries based on actual heading positions in the rendered DOM.
 *
 * Strategy:
 * 1. Use the actual scrollHeight and known page count to derive heightPerPage
 *    (this matches Puppeteer's own pagination model)
 * 2. Detect explicit page breaks and calculate the "dead space" they create
 *    (space wasted between the break element and the next page boundary)
 * 3. For each heading (including the TOC itself), calculate its effective position
 *    by adding the cumulative dead space from page breaks before it
 * 4. Divide the adjusted position by heightPerPage to get the page number
 *
 * This handles:
 * - Content before the TOC (cover pages, titles) → TOC gets correct page number
 * - Explicit page breaks → headings after breaks get correct page numbers
 * - Natural page overflow → positions map correctly to pages
 */
const buildPageNumberScript = (totalPages: number, pageContentHeightPx: number): string => `
(function() {
  var pageSpans = document.querySelectorAll('[data-toc-page]');
  if (!pageSpans.length) return;

  var totalPageCount = ${totalPages};
  var pageHeight = ${pageContentHeightPx};
  if (pageHeight <= 0 || totalPageCount <= 0) return;

  // ── Helper: get absolute top position of an element ──
  function getAbsoluteTop(el) {
    var top = 0;
    var current = el;
    while (current) {
      top += current.offsetTop;
      current = current.offsetParent;
    }
    return top;
  }

  // ── Collect explicit page break positions ──
  var breakElements = document.querySelectorAll('[data-page-break], .page-break-node');
  var breakPositions = [];
  for (var i = 0; i < breakElements.length; i++) {
    breakPositions.push(getAbsoluteTop(breakElements[i]));
  }
  breakPositions.sort(function(a, b) { return a - b; });

  // ── Calculate page number for a DOM position ──
  // Walk through the content tracking cumulative position.
  // Page breaks force advancement to the next page boundary.
  function getPageForPosition(domTop) {
    var page = 1;
    var pageBottom = pageHeight; // bottom edge of current page

    // Account for page breaks: each break advances to next page
    for (var b = 0; b < breakPositions.length; b++) {
      var bp = breakPositions[b];
      if (bp >= domTop) break; // break is after our target
      // If break is within current page, advance page
      if (bp < pageBottom) {
        // Content before the break fits on current page — break forces new page
        page++;
        pageBottom = bp + pageHeight; // next page starts after the break
      }
    }

    // For remaining content (no more breaks), calculate based on distance
    if (domTop > pageBottom - pageHeight) {
      var overflow = domTop - (pageBottom - pageHeight);
      page += Math.floor(overflow / pageHeight);
    }

    return Math.max(1, Math.min(page, totalPageCount));
  }

  // ── Assign page numbers to each TOC entry ──
  pageSpans.forEach(function(span) {
    var targetId = span.getAttribute('data-toc-page');
    if (!targetId) return;

    var targetEl = document.getElementById(targetId);
    if (!targetEl) {
      span.textContent = '';
      return;
    }

    var elTop = getAbsoluteTop(targetEl);
    span.textContent = String(getPageForPosition(elTop));
  });
})()`;

/**
 * Convert raw editor HTML to a PDF Buffer using headless Chromium.
 *
 * @param html  Raw HTML body content from the editor (already with resolved image URLs)
 * @param options  PDF generation options
 * @returns PDF as a Node.js Buffer
 */
export const htmlToPdfBuffer = async (
  html: string,
  options: HtmlToPdfOptions = {},
): Promise<Buffer> => {
  const {
    title = 'Document',
    pageSize = 'letter',
    printBackground = true,
    furniture,
  } = options;

  // Preprocess: ensure empty paragraphs (TipTap blank lines) are preserved.
  const preprocessed = html
    .replace(/<p><br\s*\/?><\/p>/gi, '<p>&nbsp;</p>')
    .replace(/<p>\s*<\/p>/gi, '<p>&nbsp;</p>');

  const fullHtml = buildExportHtml(preprocessed, { title, pageSize, furniture });

  /**
   * Furniture options shared by every `page.pdf()` call below.
   *
   * `headerTemplate`/`footerTemplate` carry the furniture because that is the
   * only PDF route where images render — verified against Chromium, where a
   * `data:` URI in a template adds ~22KB while the same image in a `@page`
   * margin box adds nothing at all.
   *
   * Applied identically on both TOC passes: the options change pagination, so
   * differing options would make the measured page numbers wrong.
   */
  const sectionCount = splitIntoFurnitureSections(preprocessed).length;
  const visibilities = resolveSectionVisibilities(furniture, sectionCount);
  const visible = visibilities[0];
  const anyFurniture = visibilities.some((v) => v.showHeader || v.showFooter);
  // More than one distinct furniture state means one template cannot serve the
  // whole document, so the render is split into passes and merged.
  const needsPerSection = anyFurniture && groupSectionsByVisibility(visibilities).length > 1;

  let furnitureOptions: PDFOptions = { displayHeaderFooter: false };
  if (anyFurniture) {
    const { headerTemplate, footerTemplate } = await buildPdfFurnitureTemplates(furniture, visible);
    const { topIn, bottomIn } = marginForFurniture(furniture, visible);
    furnitureOptions = {
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      // `preferCSSPageSize` keeps the CSS page size, but explicit margins are
      // still required here: Puppeteer draws furniture inside the margin box,
      // so without the extra room it overprints the body.
      margin: { top: `${topIn}in`, bottom: `${bottomIn}in`, left: '1in', right: '1in' },
    };
  }

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1280, height: 720 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  try {
    const page = await browser.newPage();

    await page.setContent(fullHtml, {
      waitUntil: 'networkidle0',
      timeout: 20_000,
    });

    // Check if the document has TOC page number placeholders
    const hasTocPageSpans = await page.evaluate(`!!document.querySelector('[data-toc-page]')`);

    if (hasTocPageSpans) {
      // ── Two-pass approach for accurate TOC page numbers ──

      // Pass 1: Generate temp PDF to count total pages
      const tempPdf = await page.pdf({
        preferCSSPageSize: true,
        printBackground: false,
        ...furnitureOptions,
      });
      const totalPages = countPdfPages(Buffer.from(tempPdf));

      // Calculate the content area height per page in CSS pixels (96 dpi).
      // Letter: 11in - 2in margins = 9in = 864px; A4: 297mm - 50.8mm margins ≈ 246.2mm ≈ 932px
      const pageContentHeightPx = pageSize === 'a4' ? 932 : 864;

      // Calculate real page numbers using DOM positions and inject them
      const script = buildPageNumberScript(totalPages, pageContentHeightPx);
      await page.evaluate(script);

      // Pass 2: Generate final PDF with real page numbers filled in
      const pdfUint8 = await page.pdf({
        preferCSSPageSize: true,
        printBackground,
        ...furnitureOptions,
      });

      return Buffer.from(pdfUint8);
    }

    // ── Per-section furniture: render each run of like-configured sections and merge ──
    // `headerTemplate` is fixed for a whole `page.pdf()` call, and (verified
    // against Chromium) named-page CSS cannot override it, so varying furniture
    // mid-document requires one pass per distinct state.
    if (needsPerSection) {
      const merged = await renderPerSectionPdf({
        page,
        pageSize,
        printBackground,
        furniture,
        visibilities,
      });
      if (merged) return merged;
      // Fall through to the uniform render if the merge could not be performed —
      // a correct document with slightly wrong furniture beats no document.
      console.warn('[export-pdf] Per-section furniture merge failed; falling back to uniform furniture');
    }

    // No TOC — single pass
    const pdfUint8 = await page.pdf({
      preferCSSPageSize: true,
      printBackground,
      ...furnitureOptions,
    });

    return Buffer.from(pdfUint8);
  } finally {
    await browser.close();
  }
};

/**
 * Render a document whose furniture varies between sections.
 *
 * Strategy:
 * 1. Render once to learn which PDF page each section starts on.
 * 2. For each run of consecutive sections sharing a furniture state, re-render
 *    with that run's header/footer and `pageRanges` limited to its pages.
 * 3. Concatenate the slices with `pdf-lib`.
 *
 * Returns null when the page map cannot be established, so the caller can fall
 * back rather than emit a broken document.
 */
const renderPerSectionPdf = async ({
  page,
  pageSize,
  printBackground,
  furniture,
  visibilities,
}: {
  page: Awaited<ReturnType<Browser['newPage']>>;
  pageSize: 'letter' | 'a4';
  printBackground: boolean;
  furniture: TemplateFurniture | undefined;
  visibilities: ReadonlyArray<{ showHeader: boolean; showFooter: boolean }>;
}): Promise<Buffer | null> => {
  const runs = groupSectionsByVisibility(visibilities);

  // Measure using the widest margins any run needs, so a section's content cannot
  // shift between the measuring pass and its final render.
  const maxTopIn = Math.max(...visibilities.map((v) => marginForFurniture(furniture, v).topIn));
  const maxBottomIn = Math.max(...visibilities.map((v) => marginForFurniture(furniture, v).bottomIn));

  const probe = await page.pdf({
    preferCSSPageSize: true,
    printBackground: false,
    displayHeaderFooter: true,
    headerTemplate: EMPTY_PDF_TEMPLATE,
    footerTemplate: EMPTY_PDF_TEMPLATE,
    margin: { top: `${maxTopIn}in`, bottom: `${maxBottomIn}in`, left: '1in', right: '1in' },
  });
  const totalPages = countPdfPages(Buffer.from(probe));

  const raw = await page.evaluate(
    buildSectionPageMapScript(pageContentHeightPx(pageSize, maxTopIn, maxBottomIn)),
  );
  let pageMap: Array<{ section: number; page: number }>;
  try {
    pageMap = JSON.parse(String(raw));
  } catch {
    return null;
  }
  if (!pageMap.length) return null;

  const startPageOf = new Map(pageMap.map((e) => [e.section, Math.min(e.page, totalPages)]));

  const slices: Buffer[] = [];
  for (const run of runs) {
    const from = startPageOf.get(run.startSection);
    if (!from) return null;
    // A run ends where the next section begins; the final run runs to the end.
    const nextStart = startPageOf.get(run.endSection + 1);
    const to = nextStart ? Math.max(from, nextStart - 1) : totalPages;

    const { headerTemplate, footerTemplate } = await buildPdfFurnitureTemplates(furniture, run);
    const slice = await page.pdf({
      preferCSSPageSize: true,
      printBackground,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      // Same margins on every pass — differing margins would repaginate and
      // invalidate the page map measured above.
      margin: { top: `${maxTopIn}in`, bottom: `${maxBottomIn}in`, left: '1in', right: '1in' },
      pageRanges: `${from}-${to}`,
    });
    slices.push(Buffer.from(slice));
  }

  if (slices.length === 1) return slices[0];

  const merged = await PDFDocument.create();
  for (const slice of slices) {
    const src = await PDFDocument.load(slice);
    const copied = await merged.copyPages(src, src.getPageIndices());
    for (const p of copied) merged.addPage(p);
  }
  return Buffer.from(await merged.save());
};
