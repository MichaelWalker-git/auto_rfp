import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { type RFPDocumentContent } from '@auto-rfp/core';
import { loadRFPDocumentHtml } from './rfp-document';
import { requireEnv } from './env';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const PRESIGN_EXPIRES_IN = Number(process.env.PRESIGN_EXPIRES_IN || 3600);
const s3ExportClient = new S3Client({ region: REGION });

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
  lines.push('    h1 { font-size: 1.875rem; font-weight: 700; margin: 1.5rem 0 0.5rem; color: #111827; border-bottom: 3px solid #4f46e5; padding-bottom: 0.3em; }');
  lines.push('    h2 { font-size: 1.5rem; font-weight: 600; margin: 1.25rem 0 0.5rem; color: #1f2937; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.2em; }');
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

