/**
 * Server-side HTML → PDF conversion using Puppeteer + Lambda-compatible Chromium.
 *
 * Renders the styled HTML in a headless browser and prints to PDF,
 * producing output that is pixel-identical to the rendered HTML.
 */

import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { buildExportHtml, type BuildExportHtmlOptions } from './export-html-builder';

export interface HtmlToPdfOptions extends BuildExportHtmlOptions {
  /** Whether to print background graphics (default: true) */
  printBackground?: boolean;
}

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
  // TipTap outputs <p></p> or <p><br></p> for blank lines — replace with
  // non-breaking space so they occupy a full line height in the PDF.
  const preprocessed = html
    .replace(/<p><br\s*\/?><\/p>/gi, '<p>&nbsp;</p>')
    .replace(/<p>\s*<\/p>/gi, '<p>&nbsp;</p>');

  // Build the full styled HTML document
  const fullHtml = buildExportHtml(preprocessed, { title, pageSize });

  // Launch headless Chromium (Lambda-compatible)
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: { width: 1280, height: 720 },
    executablePath: await chromium.executablePath(),
    headless: true,
  });

  try {
    const page = await browser.newPage();

    // Set the HTML content and wait for all resources (images) to load
    await page.setContent(fullHtml, {
      waitUntil: 'networkidle0',
      timeout: 20_000,
    });

    // Generate PDF — use preferCSSPageSize so the @page CSS controls layout.
    // The HTML already has @page { margin: 1in } and body padding for spacing.
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
