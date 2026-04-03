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
import { buildExportHtml, type BuildExportHtmlOptions } from './export-html-builder';

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
  } = options;

  // Preprocess: ensure empty paragraphs (TipTap blank lines) are preserved.
  const preprocessed = html
    .replace(/<p><br\s*\/?><\/p>/gi, '<p>&nbsp;</p>')
    .replace(/<p>\s*<\/p>/gi, '<p>&nbsp;</p>');

  const fullHtml = buildExportHtml(preprocessed, { title, pageSize });

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
        displayHeaderFooter: false,
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
        displayHeaderFooter: false,
      });

      return Buffer.from(pdfUint8);
    }

    // No TOC — single pass
    const pdfUint8 = await page.pdf({
      preferCSSPageSize: true,
      printBackground,
      displayHeaderFooter: false,
    });

    return Buffer.from(pdfUint8);
  } finally {
    await browser.close();
  }
};
