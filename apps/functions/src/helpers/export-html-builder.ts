/**
 * Builds a complete, styled HTML document from raw editor HTML content.
 * This is the single source of truth for export styling — PDF, DOCX, and HTML
 * exports all use this same HTML so they look identical to the rendered editor.
 */

import { resolveFurnitureVisibility, type TemplateFurniture } from '@auto-rfp/core';
import {
  marginForFurniture,
  splitIntoFurnitureSections,
} from './export-furniture';

export interface BuildExportHtmlOptions {
  /** Document title for <title> and optional header */
  title?: string;
  /** Page size for print CSS */
  pageSize?: 'letter' | 'a4';
  /**
   * Running header/footer configuration, copied forward from the source template.
   * Absent ⇒ no furniture, and the emitted CSS is byte-identical to before this
   * feature existed.
   */
  furniture?: TemplateFurniture;
}

/**
 * Insert zero-height markers at each page-break-delimited section boundary.
 *
 * The PDF renderer measures these to learn which printed page a section starts
 * on, which is how it slices the document into per-section furniture passes.
 *
 * Markers rather than wrappers: wrapping each section in a `<div>` introduces a
 * block box that can absorb margins and shift pagination, and assigning it a CSS
 * named page forced a spurious extra page (measured: a 3-page document became
 * 4). An empty inline-block with no size cannot move anything.
 *
 * Only applied when overrides exist — otherwise the body HTML passes through
 * untouched and existing documents stay byte-identical.
 */
const tagFurnitureSections = (bodyHtml: string, furniture?: TemplateFurniture): string => {
  if (!furniture?.sectionOverrides.length) return bodyHtml;

  const marker = (i: number) =>
    `<span data-furniture-section="${i}" style="display:block;height:0;margin:0;padding:0;font-size:0;line-height:0"></span>`;

  const sections = splitIntoFurnitureSections(bodyHtml);
  if (sections.length <= 1) return `${marker(0)}${bodyHtml}`;

  // Re-emit the page break that splitting consumed, preserving the original layout.
  return sections
    .map((section, i) => `${marker(i)}${section}`)
    .join('<div data-page-break="true" style="break-after: page; page-break-after: always;"></div>');
};

export const buildExportHtml = (bodyHtml: string, options: BuildExportHtmlOptions = {}): string => {
  const { title = 'Document', pageSize = 'letter', furniture } = options;
  const pageDims = pageSize === 'a4'
    ? { width: '210mm', height: '297mm' }
    : { width: '8.5in', height: '11in' };

  // Section 0 drives the base margins. Margins must grow to reserve the furniture
  // band, or the running header prints on top of the body text.
  const baseVisible = resolveFurnitureVisibility(furniture, 0);
  const { topIn, bottomIn } = marginForFurniture(furniture, baseVisible);
  const taggedBody = tagFurnitureSections(bodyHtml, furniture);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    @page {
      size: ${pageDims.width} ${pageDims.height};
      margin: ${topIn}in 1in ${bottomIn}in 1in;
    }
    * { box-sizing: border-box; }
    body {
      font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
      font-size: 14px;
      line-height: 1.75;
      color: #374151;
      max-width: 816px;
      margin: 0 auto;
      padding: 72px 96px;
      background: #fff;
    }
    /* ── Headings ── */
    h1 {
      font-size: 1.875rem;
      font-weight: 700;
      margin: 1.5rem 0 0.5rem;
      color: #111827;
    }
    h2 {
      font-size: 1.5rem;
      font-weight: 600;
      margin: 1.25rem 0 0.5rem;
      color: #1f2937;
    }
    h3 {
      font-size: 1.25rem;
      font-weight: 600;
      margin: 1rem 0 0.4rem;
      color: #1f2937;
    }
    h4 {
      font-size: 1.1rem;
      font-weight: 600;
      margin: 0.75rem 0 0.3rem;
      color: #374151;
    }
    h5, h6 {
      font-size: 1rem;
      font-weight: 600;
      margin: 0.5rem 0 0.25rem;
      color: #374151;
    }
    /* ── Body text ── */
    p {
      margin: 0 0 0.75rem;
      line-height: 1.75;
    }
    /* ── Images ── */
    img {
      max-width: 100%;
      height: auto;
      border-radius: 4px;
      margin: 0.5rem 0;
      display: block;
    }
    /* ── Blockquote ── */
    blockquote {
      border-left: 4px solid #d1d5db;
      padding-left: 1rem;
      margin: 1rem 0;
      font-style: italic;
      color: #6b7280;
    }
    /* ── Code ── */
    pre {
      background: #f3f4f6;
      border-radius: 4px;
      padding: 0.75rem 1rem;
      font-family: "Courier New", monospace;
      font-size: 0.875rem;
      overflow-x: auto;
      margin: 0.5rem 0;
    }
    code {
      background: #f3f4f6;
      border-radius: 3px;
      padding: 0.1em 0.3em;
      font-family: "Courier New", monospace;
      font-size: 0.875em;
    }
    pre code {
      background: none;
      padding: 0;
    }
    /* ── Lists ── */
    ul, ol {
      padding-left: 1.5rem;
      margin: 0.5rem 0 0.75rem;
    }
    ul { list-style-type: disc; }
    ol { list-style-type: decimal; }
    li {
      margin: 0.2rem 0;
      line-height: 1.75;
    }
    /* ── Horizontal rule ── */
    hr {
      border: none;
      border-top: 2px solid #e5e7eb;
      margin: 1.5rem 0;
    }
    /* ── Tables ── */
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1rem 0;
    }
    th, td {
      border: 1px solid #d1d5db;
      padding: 0.5rem 0.75rem;
      vertical-align: top;
    }
    th {
      background: #f9fafb;
      font-weight: 600;
      text-align: left;
    }
    /* ── Inline ── */
    mark {
      background-color: #fef08a;
      border-radius: 2px;
      padding: 0 1px;
    }
    a {
      color: #4f46e5;
      text-decoration: underline;
    }
    strong { font-weight: 700; }
    em { font-style: italic; }
    /* ── Page breaks ── */
    div[data-page-break] {
      break-after: page;
      page-break-after: always;
    }
    .page-break-node {
      break-after: page;
      page-break-after: always;
    }
    /* ── Table of Contents ── */
    .table-of-contents {
      padding: 12px 0;
      margin: 16px 0;
      page-break-inside: avoid;
    }
    .table-of-contents a {
      text-decoration: none;
      color: inherit;
    }
    .table-of-contents a:hover {
      text-decoration: underline;
    }
    .table-of-contents .toc-entry {
      margin: 2px 0;
    }
    /* ── Page furniture (running header / footer) ── */
    .export-furniture {
      color: #6b7280;
      font-size: 9pt;
      line-height: 1.3;
    }
    .export-furniture img {
      display: inline-block;
      margin: 0;
      max-height: 100%;
      border-radius: 0;
    }
    .export-furniture p { margin: 0; }
    .export-furniture--header {
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 6px;
      margin-bottom: 18px;
    }
    .export-furniture--footer {
      border-top: 1px solid #e5e7eb;
      padding-top: 6px;
      margin-top: 18px;
    }
    /* Screen-only: in print, the real running furniture comes from the PDF
       renderer's header/footer templates, so showing this band too would
       duplicate it on the first and last page. */
    @media print {
      .export-furniture { display: none; }
    }
    /* ── Print overrides ── */
    @media print {
      body {
        padding: 0;
        margin: 0;
        max-width: none;
      }
      div[data-page-break] {
        break-after: page;
        page-break-after: always;
      }
    }
  </style>
</head>
<body>${renderFurnitureBand(furniture, baseVisible, 'header')}${taggedBody}${renderFurnitureBand(furniture, baseVisible, 'footer')}</body>
</html>`;
};

/**
 * Render a static header/footer band for standalone HTML viewing.
 *
 * Browsers only materialise `@page` margin boxes when printing, so an HTML export
 * opened on screen would otherwise show no furniture at all and look inconsistent
 * with the PDF. Hidden in print (see CSS above) to avoid double-rendering.
 *
 * Page tokens are rendered as literals here — a scrolling HTML page has no page
 * number to report.
 */
const renderFurnitureBand = (
  furniture: TemplateFurniture | undefined,
  visible: { showHeader: boolean; showFooter: boolean },
  which: 'header' | 'footer',
): string => {
  const show = which === 'header' ? visible.showHeader : visible.showFooter;
  const part = which === 'header' ? furniture?.header : furniture?.footer;
  if (!show || !part) return '';

  const align = part.align.toLowerCase();
  const html = part.html
    .replace(/\{\{PAGE_NUMBER\}\}/g, '1')
    .replace(/\{\{TOTAL_PAGES\}\}/g, '1');

  return `<div class="export-furniture export-furniture--${which}" style="text-align: ${align}">${html}</div>`;
};

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
