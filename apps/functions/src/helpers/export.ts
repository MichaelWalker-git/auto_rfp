import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { type RFPDocumentContent } from '@auto-rfp/core';
import { loadRFPDocumentHtml } from './rfp-document';
import { requireEnv } from './env';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const PRESIGN_EXPIRES_IN = Number(process.env.PRESIGN_EXPIRES_IN || 3600);
const s3ExportClient = new S3Client({ region: REGION });

// ─── Table of Contents expansion ──────────────────────────────────────────────

/** Decode common HTML entities to plain text for TOC display. */
const decodeHtmlEntities = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&hellip;/g, '…')
    .replace(/&rsquo;/g, '\u2019')
    .replace(/&lsquo;/g, '\u2018')
    .replace(/&rdquo;/g, '\u201D')
    .replace(/&ldquo;/g, '\u201C');

/** Strip all HTML tags and decode entities to get clean heading text. */
const extractPlainText = (html: string): string =>
  decodeHtmlEntities(html.replace(/<[^>]+>/g, '')).trim();

const escapeHtmlForToc = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');

/**
 * Find the TOC placeholder `<div data-table-of-contents="true">…</div>` in HTML,
 * correctly handling nested `<div>` elements by counting nesting depth.
 *
 * Returns the start index and full length of the matched placeholder, or null.
 */
export const findTocPlaceholderInHtml = (html: string): { index: number; length: number } | null => {
  if (!html) return null;

  const openTagRe = /<div[^>]*data-table-of-contents="true"[^>]*>/i;
  const openMatch = openTagRe.exec(html);
  if (!openMatch || openMatch.index === undefined) return null;

  const startIdx = openMatch.index;
  const afterOpenTag = startIdx + openMatch[0].length;

  // Self-closing or immediately closed: <div …></div> or <div … />
  if (openMatch[0].endsWith('/>')) return { index: startIdx, length: openMatch[0].length };
  if (html.slice(afterOpenTag).startsWith('</div>')) {
    return { index: startIdx, length: afterOpenTag + 6 - startIdx };
  }

  // Walk forward counting nested <div> depth to find the matching </div>
  let depth = 1;
  const divTagRe = /<\/?div[\s>]/gi;
  divTagRe.lastIndex = afterOpenTag;
  let m: RegExpExecArray | null;
  while ((m = divTagRe.exec(html)) !== null) {
    if (m[0].startsWith('</')) {
      depth--;
      if (depth === 0) {
        // Find the full closing tag end
        const closeEnd = html.indexOf('>', m.index) + 1;
        return { index: startIdx, length: closeEnd - startIdx };
      }
    } else {
      depth++;
    }
  }

  // No matching close — fall back to just the opening tag
  return { index: startIdx, length: openMatch[0].length };
};

export interface TocHeading {
  level: number;
  text: string;
  id: string;
}

/**
 * Extract the user's TOC title from the heading immediately before the TOC placeholder.
 * Users typically place a heading like "Table of Contents" before the TOC block.
 * Returns the heading text, or empty string if no heading is found.
 */
export const extractTocTitle = (htmlBeforeToc: string): string => {
  const match = htmlBeforeToc.match(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>\s*$/i);
  return match ? extractPlainText(match[2]) : '';
};

/**
 * Estimate page numbers for headings in an HTML document.
 *
 * Uses a cumulative content tracking approach:
 * - Walks through the HTML sequentially, accumulating "content units"
 * - Plain text characters contribute to content volume (~charsPerPage per page)
 * - Explicit page breaks (`data-page-break`) force a new page, wasting remaining space
 * - Images add significant content volume (~1/3 page equivalent)
 * - Headings add extra vertical space (~100 chars equivalent)
 *
 * This produces more accurate page estimates than the previous fraction-based
 * approach because it properly handles page breaks (which waste remaining space
 * on the current page) and tracks content flow sequentially.
 *
 * Returns an array of estimated page numbers (1-indexed) for each heading.
 */
export const estimateHeadingPages = (html: string, startPage = 1, charsPerPage = 3000): number[] => {
  if (!html) return [];

  // ── Tokenize the HTML into sequential content blocks ──
  // We walk through the HTML tracking cumulative content volume and page breaks.
  const blockRe = /(<div[^>]*(?:data-page-break|page-break-node)[^>]*>[\s\S]*?<\/div>)|(<img[^>]*>)|(<h([1-6])[^>]*>[\s\S]*?<\/h\4>)|(<(?:p|li|blockquote|td|th|pre)[^>]*>[\s\S]*?<\/(?:p|li|blockquote|td|th|pre)>)/gi;

  // First, find heading positions in the original HTML for result mapping
  const headingPositions: number[] = [];
  const headingPosRegex = /<h[1-6][^>]*>/gi;
  let posMatch: RegExpExecArray | null;
  while ((posMatch = headingPosRegex.exec(html)) !== null) {
    headingPositions.push(posMatch.index);
  }

  if (headingPositions.length === 0) return [];

  // ── Walk through HTML sequentially, tracking content volume ──
  let cumulativeChars = 0;
  let currentPage = startPage;
  const pageForPosition = new Map<number, number>(); // htmlPosition → pageNumber

  // Helper to strip HTML and count content characters
  const countContentChars = (htmlFragment: string): number => {
    const plain = htmlFragment
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/\s+/g, ' ')
      .trim();
    return plain.length;
  };

  // Track which heading index we're looking for next
  let nextHeadingIdx = 0;

  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(html)) !== null) {
    const pageBreakDiv = match[1];
    const imgTag = match[2];
    const headingTag = match[3];

    // Record page number for any headings we've passed
    while (nextHeadingIdx < headingPositions.length && headingPositions[nextHeadingIdx] <= match.index) {
      pageForPosition.set(headingPositions[nextHeadingIdx], currentPage);
      nextHeadingIdx++;
    }

    if (pageBreakDiv) {
      // Explicit page break: advance to next page, wasting remaining space
      currentPage++;
      cumulativeChars = 0; // Reset content counter for new page
      continue;
    }

    if (imgTag) {
      // Images take ~1/3 page of vertical space
      cumulativeChars += Math.round(charsPerPage * 0.33);
    } else if (headingTag) {
      // Headings take extra vertical space (~100 chars equivalent for spacing)
      const textChars = countContentChars(headingTag);
      cumulativeChars += textChars + 100;
    } else {
      // Regular content block (paragraph, list item, etc.)
      const textChars = countContentChars(match[0]);
      cumulativeChars += textChars;
    }

    // Check if we've exceeded the current page's capacity
    while (cumulativeChars >= charsPerPage) {
      cumulativeChars -= charsPerPage;
      currentPage++;
    }
  }

  // Record page numbers for any remaining headings after the last block
  while (nextHeadingIdx < headingPositions.length) {
    pageForPosition.set(headingPositions[nextHeadingIdx], currentPage);
    nextHeadingIdx++;
  }

  // Build result array in heading order
  return headingPositions.map((pos) => pageForPosition.get(pos) ?? startPage);
};

/**
 * Extract headings from an HTML string. Returns an array of heading objects
 * with consistent IDs that can be used for both TOC entries and heading anchors.
 */
export const extractHeadingsFromHtml = (html: string): TocHeading[] => {
  const headingRegex = /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi;
  const headings: TocHeading[] = [];
  let match: RegExpExecArray | null;
  let counter = 0;

  while ((match = headingRegex.exec(html)) !== null) {
    const level = parseInt(match[1], 10);
    const text = extractPlainText(match[3]);
    if (text) {
      counter++;
      headings.push({ level, text, id: `toc-heading-${counter}` });
    }
  }

  return headings;
};

/**
 * Expand `<div data-table-of-contents="true">` placeholders in HTML into
 * a fully rendered Table of Contents by scanning the document for headings.
 *
 * This is used during export so the TOC (which is rendered dynamically in the
 * editor via a React NodeView) gets baked into the static HTML for PDF/DOCX/HTML.
 *
 * The function uses a single-pass heading extraction to ensure TOC entry IDs
 * and heading anchor IDs are always in sync — preventing broken links.
 */
export const expandTableOfContents = (html: string): string => {
  if (!html || !html.includes('data-table-of-contents')) return html;

  // Find the TOC placeholder using nesting-aware matcher (handles nested divs)
  const tocPos = findTocPlaceholderInHtml(html);

  if (!tocPos) {
    return html;
  }

  const beforeToc = html.slice(0, tocPos.index);
  const afterTocStart = tocPos.index + tocPos.length;
  let afterToc = html.slice(afterTocStart);

  // ── Single-pass: extract headings from AFTER the TOC and assign IDs ──
  // This ensures the heading list and the injected IDs use the exact same counter,
  // eliminating any possibility of ID mismatch.
  const headings: TocHeading[] = [];
  let idCounter = 0;

  afterToc = afterToc.replace(
    /<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (fullMatch, lvl, attrs, inner) => {
      const text = extractPlainText(inner);
      if (!text) return fullMatch;

      idCounter++;
      const id = `toc-heading-${idCounter}`;
      headings.push({ level: parseInt(lvl, 10), text, id });

      // Add id attribute only if the heading doesn't already have one
      if (/\bid\s*=/.test(attrs)) return fullMatch;
      return `<h${lvl}${attrs} id="${id}">${inner}</h${lvl}>`;
    },
  );

  // ── Extract the user's TOC title from the heading immediately before the TOC ──
  // Users typically place a heading like "Table of Contents" before the TOC block.
  // We use that heading text as the TOC self-entry title instead of a hardcoded string.
  const tocTitleMatch = beforeToc.match(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>\s*$/i);
  const tocTitle = tocTitleMatch ? extractPlainText(tocTitleMatch[2]) : '';

  // ── Build the TOC HTML ──
  const minLevel = headings.length > 0 ? Math.min(...headings.map((h) => h.level)) : 1;

  let tocHtml: string;
  if (headings.length === 0) {
    tocHtml =
      '<div class="table-of-contents" data-table-of-contents="true">' +
      '<p style="color:#9ca3af;font-style:italic;font-size:12px;">No headings found.</p>' +
      '</div>';
  } else {
    // Estimate which page the TOC starts on by measuring content volume before it.
    const beforeTocText = beforeToc.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
    const tocStartPage = Math.max(1, Math.floor(beforeTocText.length / 3000) + 1);

    // Content headings start after the TOC page(s).
    // Estimate TOC takes ~1 page, so content starts on tocStartPage + 1.
    const contentStartPage = tocStartPage + 1;

    // Estimate page numbers using the shared estimator that accounts for
    // page breaks, images, headings, and plain text content volume.
    const pageNumbers = estimateHeadingPages(afterToc, contentStartPage);

    // Build TOC entry helper
    const tocEntry = (text: string, id: string, level: number, pageNum: number) => {
      const indent = (level - minLevel) * 16;
      const fontSize = level <= minLevel ? '12px' : level <= minLevel + 1 ? '11px' : '10px';
      const fontWeight = level <= minLevel ? '600' : level <= minLevel + 1 ? '500' : '400';
      const color = level <= minLevel ? '#111827' : level <= minLevel + 1 ? '#374151' : '#6b7280';

      return (
        `<div class="toc-entry toc-level-${level}" style="padding-left:${indent}px;margin:0;display:flex;align-items:baseline;line-height:1.9;">` +
        `<a href="#${id}" style="font-size:${fontSize};font-weight:${fontWeight};color:${color};text-decoration:none;white-space:nowrap;">${escapeHtmlForToc(text)}</a>` +
        `<span style="flex:1;border-bottom:1px dotted #d1d5db;min-width:20px;margin:0 6px 3px;"></span>` +
        `<span class="toc-page" data-toc-page="${id}" style="font-size:${fontSize};color:${color};white-space:nowrap;min-width:12px;text-align:right;">${pageNum}</span>` +
        `</div>`
      );
    };

    // TOC self-entry: use the user's heading title if found, otherwise use the TOC title
    // Only include the self-entry if the user has a title heading before the TOC
    const tocSelfEntry = tocTitle
      ? tocEntry(tocTitle, 'toc-self', minLevel, tocStartPage)
      : '';

    const contentEntries = headings
      .map((h, i) => {
        const pageNum = pageNumbers[i] ?? contentStartPage;
        return tocEntry(h.text, h.id, h.level, pageNum);
      })
      .join('\n');

    tocHtml =
      `<div class="table-of-contents" id="toc-self" data-table-of-contents="true" style="padding:12px 0;margin:16px 0;page-break-inside:avoid;">` +
      `<nav>${tocSelfEntry}\n${contentEntries}</nav>` +
      `</div>`;
  }

  // Reassemble: before + TOC + after (with IDs injected)
  return beforeToc + tocHtml + afterToc;
};

// ─── S3 image resolver ────────────────────────────────────────────────────────

/**
 * Resolve all `data-s3-key` attributes in an HTML string to presigned GET URLs.
 * Used by export lambdas so exported documents contain real image URLs.
 */
export async function resolveS3ImagesForExport(html: string): Promise<string> {
  if (!html) return html;

  const s3KeyRegex = /data-s3-key="([^"]+)"/g;
  const keys: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = s3KeyRegex.exec(html)) !== null) {
    keys.push(match[1]);
  }
  if (!keys.length) return html;

  // Resolve all keys in parallel
  const urlMap = new Map<string, string>();
  await Promise.all(
    keys.map(async (key) => {
      try {
        const url = await getSignedUrl(
          s3ExportClient as Parameters<typeof getSignedUrl>[0],
          new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: key }),
          { expiresIn: PRESIGN_EXPIRES_IN },
        );
        urlMap.set(key, url);
      } catch (err) {
        console.warn(`Failed to resolve S3 image key for export: ${key}`, err);
      }
    }),
  );

  return html.replace(
    /<img([^>]*?)data-s3-key="([^"]+)"([^>]*?)>/g,
    (fullMatch, before, key, after) => {
      const resolvedUrl = urlMap.get(key);
      if (!resolvedUrl) return fullMatch;
      const withoutSrc = (before + after).replace(/\s*src="[^"]*"/, '');
      return `<img${withoutSrc} src="${resolvedUrl}">`;
    },
  );
}

// ─── HTML content loader ──────────────────────────────────────────────────────

/**
 * Load the HTML content for a document.
 * Prefers S3 (htmlContentKey) over inline DynamoDB content.
 * Resolves data-s3-key image references to presigned URLs.
 */
export async function loadDocumentHtmlForExport(doc: Record<string, unknown>): Promise<string> {
  if (!doc.htmlContentKey || typeof doc.htmlContentKey !== 'string') {
    console.warn(`loadDocumentHtmlForExport: document has no htmlContentKey — returning empty HTML`);
    return '';
  }

  const html = await loadRFPDocumentHtml(doc.htmlContentKey);
  // Resolve data-s3-key images to presigned URLs for export
  return resolveS3ImagesForExport(html);
}

/**
 * Shared utilities for proposal export across all formats.
 */

export interface ExportRequest {
  projectId: string;
  proposalId: string;
  opportunityId: string;
  format: ExportFormat;
  options?: ExportOptions;
}

export type ExportFormat = 'pdf' | 'html' | 'txt' | 'pptx' | 'md' | 'docx';

export interface ExportOptions {
  pageSize?: 'letter' | 'a4';
  includeTableOfContents?: boolean;
  includeCitations?: boolean;
  pageLimitsPerSection?: number;
}

export interface ExportResult {
  success: boolean;
  proposal: { id: string; title: string };
  export: {
    format: ExportFormat;
    bucket: string;
    key: string;
    url: string;
    expiresIn: number;
    contentType: string;
    fileName: string;
  };
}

export const CONTENT_TYPES: Record<ExportFormat, string> = {
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  md: 'text/markdown; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export const FILE_EXTENSIONS: Record<ExportFormat, string> = {
  pdf: '.pdf',
  html: '.html',
  txt: '.txt',
  pptx: '.pptx',
  md: '.md',
  docx: '.docx',
};

export function sanitizeFileName(name: string): string {
  return (name || 'proposal')
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 160);
}

export function buildS3Key(
  organizationId: string,
  projectId: string,
  opportunityId: string,
  proposalId: string,
  title: string,
  format: ExportFormat,
): string {
  const sanitized = sanitizeFileName(title);
  return `${organizationId}/${projectId}/${opportunityId}/${proposalId}/${sanitized}${FILE_EXTENSIONS[format]}`;
}

// ─── HTML → plain text strip ──────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Flatten proposal document into plain text for use by various exporters.
 * Uses htmlContent as the source of truth.
 */
export function flattenProposalToText(doc: RFPDocumentContent): string {
  const lines: string[] = [];

  lines.push(doc.title);
  lines.push('='.repeat(doc.title.length));
  lines.push('');

  if (doc.customerName) {
    lines.push(`Customer: ${doc.customerName}`);
    lines.push('');
  }

  if (doc.opportunityId) {
    lines.push(`Opportunity ID: ${doc.opportunityId}`);
    lines.push('');
  }

  lines.push(`Date: ${new Date().toLocaleDateString()}`);
  lines.push('');

  if (doc.outlineSummary) {
    lines.push('Executive Summary');
    lines.push('-'.repeat(17));
    lines.push('');
    lines.push(doc.outlineSummary);
    lines.push('');
  }

  if (doc.content) {
    lines.push(stripHtml(doc.content));
  }

  return lines.join('\n');
}

/**
 * Convert proposal document to Markdown format.
 * Uses htmlContent as the source of truth.
 */
export function proposalToMarkdown(doc: RFPDocumentContent): string {
  const lines: string[] = [];

  lines.push(`# ${doc.title}`);
  lines.push('');

  if (doc.customerName) {
    lines.push(`**Customer:** ${doc.customerName}`);
    lines.push('');
  }

  if (doc.opportunityId) {
    lines.push(`**Opportunity ID:** ${doc.opportunityId}`);
    lines.push('');
  }

  lines.push(`**Date:** ${new Date().toLocaleDateString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  if (doc.outlineSummary) {
    lines.push('## Executive Summary');
    lines.push('');
    lines.push(doc.outlineSummary);
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  if (doc.content) {
    // Convert HTML headings to Markdown headings, strip remaining tags
    const md = doc.content
      .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n')
      .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
      .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
      .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n')
      .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
      .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<\/li>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#039;/g, "'")
      .replace(/&nbsp;/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    lines.push(md);
  }

  return lines.join('\n');
}

/**
 * Convert proposal document to full HTML page for export.
 * Wraps the stored htmlContent in a complete HTML document with styling.
 * The `doc.content` field should already contain the full styled HTML body
 * (loaded from S3 via loadDocumentHtmlForExport before calling this function).
 */
export function proposalToHtml(doc: RFPDocumentContent): string {
  const escapeHtml = (text: string): string =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  const lines: string[] = [];

  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="en">');
  lines.push('<head>');
  lines.push('  <meta charset="UTF-8">');
  lines.push('  <meta name="viewport" content="width=device-width, initial-scale=1.0">');
  lines.push(`  <title>${escapeHtml(doc.title)}</title>`);
  lines.push('  <style>');
  // Page layout — matches the Word-like editor (816px wide, 1-inch margins)
  lines.push('    * { box-sizing: border-box; }');
  lines.push('    body { font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; background: #f3f4f6; margin: 0; padding: 32px 16px; color: #374151; line-height: 1.6; }');
  lines.push('    .page { max-width: 816px; margin: 0 auto; background: #fff; padding: 72px 96px; box-shadow: 0 2px 8px rgba(0,0,0,0.12); }');
  lines.push('    .metadata { color: #6b7280; font-size: 0.9em; margin-bottom: 24px; border-bottom: 1px solid #e5e7eb; padding-bottom: 12px; }');
  lines.push('    .metadata span { display: inline-block; margin-right: 24px; }');
  // Typography — matches the Tiptap editor styles
  lines.push('    h1 { font-size: 1.875rem; font-weight: 700; margin: 1.5rem 0 0.5rem; color: #111827; }');
  lines.push('    h2 { font-size: 1.5rem; font-weight: 600; margin: 1.25rem 0 0.5rem; color: #1f2937; }');
  lines.push('    h3 { font-size: 1.25rem; font-weight: 600; margin: 1rem 0 0.4rem; color: #1f2937; }');
  lines.push('    p { margin: 0 0 0.75rem; line-height: 1.75; color: #374151; }');
  lines.push('    ul { list-style: disc; margin: 0 0 0.75rem; padding-left: 1.5rem; }');
  lines.push('    ol { list-style: decimal; margin: 0 0 0.75rem; padding-left: 1.5rem; }');
  lines.push('    li { margin-bottom: 0.25rem; line-height: 1.75; color: #374151; }');
  lines.push('    blockquote { border-left: 4px solid #d1d5db; padding-left: 1rem; margin: 1rem 0; font-style: italic; color: #6b7280; }');
  lines.push('    table { width: 100%; border-collapse: collapse; margin: 1rem 0; }');
  lines.push('    th { background: #4f46e5; color: #fff; padding: 0.6em 0.8em; text-align: left; font-size: 0.9em; font-weight: 600; }');
  lines.push('    td { padding: 0.6em 0.8em; font-size: 0.9em; color: #374151; border-bottom: 1px solid #e5e7eb; }');
  lines.push('    tr:nth-child(even) td { background: #f9fafb; }');
  lines.push('    a { color: #2563eb; text-decoration: underline; }');
  lines.push('    strong { font-weight: 700; }');
  lines.push('    em { font-style: italic; }');
  lines.push('    code { background: #f3f4f6; padding: 0.1em 0.3em; border-radius: 3px; font-family: monospace; font-size: 0.9em; }');
  lines.push('    img { max-width: 100%; border-radius: 4px; margin: 0.5rem 0; }');
  lines.push('    hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.5rem 0; }');
  lines.push('    @media print { body { background: #fff; padding: 0; } .page { box-shadow: none; padding: 20px; } }');
  lines.push('  </style>');
  lines.push('</head>');
  lines.push('<body>');
  lines.push('  <div class="page">');

  // Metadata bar
  if (doc.customerName || doc.opportunityId) {
    lines.push('    <div class="metadata">');
    if (doc.customerName) {
      lines.push(`      <span><strong>Customer:</strong> ${escapeHtml(doc.customerName)}</span>`);
    }
    if (doc.opportunityId) {
      lines.push(`      <span><strong>Opportunity ID:</strong> ${escapeHtml(doc.opportunityId)}</span>`);
    }
    lines.push(`      <span><strong>Date:</strong> ${new Date().toLocaleDateString()}</span>`);
    lines.push('    </div>');
  }

  // Main content — use the full HTML body from the editor/S3
  if (doc.content) {
    lines.push(`    <div class="content">${doc.content}</div>`);
  } else {
    // Fallback when no HTML content available
    lines.push(`    <h1>${escapeHtml(doc.title)}</h1>`);
    if (doc.outlineSummary) {
      lines.push(`    <p>${escapeHtml(doc.outlineSummary)}</p>`);
    }
  }

  lines.push('  </div>');
  lines.push('</body>');
  lines.push('</html>');

  return lines.join('\n');
}

