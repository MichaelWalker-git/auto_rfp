/**
 * Builds a complete, styled HTML document from raw editor HTML content.
 * This is the single source of truth for export styling — PDF, DOCX, and HTML
 * exports all use this same HTML so they look identical to the rendered editor.
 */

export interface BuildExportHtmlOptions {
  /** Document title for <title> and optional header */
  title?: string;
  /** Page size for print CSS */
  pageSize?: 'letter' | 'a4';
}

/**
 * Wrap raw TipTap editor HTML in a fully styled HTML document.
 * The styles here match the editor's rendering so exports look identical.
 */
export const buildExportHtml = (bodyHtml: string, options: BuildExportHtmlOptions = {}): string => {
  const { title = 'Document', pageSize = 'letter' } = options;
  const pageDims = pageSize === 'a4'
    ? { width: '210mm', height: '297mm' }
    : { width: '8.5in', height: '11in' };

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    @page {
      size: ${pageDims.width} ${pageDims.height};
      margin: 1in;
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
<body>${bodyHtml}</body>
</html>`;
};

const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
