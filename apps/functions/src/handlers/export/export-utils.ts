import { type RFPDocumentContent } from '@auto-rfp/core';

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
  lines.push('    body { font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; max-width: 900px; margin: 0 auto; padding: 40px 20px; color: #333; line-height: 1.6; }');
  lines.push('    h1 { color: #1a1a2e; border-bottom: 3px solid #4f46e5; padding-bottom: 12px; margin-top: 0; }');
  lines.push('    h2 { color: #1a1a2e; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 32px; }');
  lines.push('    h3 { color: #374151; margin-top: 24px; }');
  lines.push('    p { margin: 0 0 1em; line-height: 1.7; color: #374151; }');
  lines.push('    ul, ol { margin: 0 0 1em; padding-left: 1.5em; }');
  lines.push('    li { margin-bottom: 0.4em; line-height: 1.6; color: #374151; }');
  lines.push('    table { width: 100%; border-collapse: collapse; margin: 1em 0; }');
  lines.push('    th { background: #4f46e5; color: #fff; padding: 0.6em 0.8em; text-align: left; font-size: 0.9em; }');
  lines.push('    td { padding: 0.6em 0.8em; font-size: 0.9em; color: #374151; border-bottom: 1px solid #e2e8f0; }');
  lines.push('    .metadata { color: #718096; font-size: 0.95em; margin-bottom: 24px; }');
  lines.push('    .metadata span { display: inline-block; margin-right: 24px; }');
  lines.push('    @media print { body { max-width: 100%; padding: 20px; } }');
  lines.push('  </style>');
  lines.push('</head>');
  lines.push('<body>');

  lines.push('  <div class="metadata">');
  if (doc.customerName) {
    lines.push(`    <span><strong>Customer:</strong> ${escapeHtml(doc.customerName)}</span>`);
  }
  if (doc.opportunityId) {
    lines.push(`    <span><strong>Opportunity ID:</strong> ${escapeHtml(doc.opportunityId)}</span>`);
  }
  lines.push(`    <span><strong>Date:</strong> ${new Date().toLocaleDateString()}</span>`);
  lines.push('  </div>');

  if (doc.content) {
    lines.push(`  <div class="content">${doc.content}</div>`);
  } else {
    lines.push(`  <h1>${escapeHtml(doc.title)}</h1>`);
    if (doc.outlineSummary) {
      lines.push(`  <p>${escapeHtml(doc.outlineSummary)}</p>`);
    }
  }

  lines.push('</body>');
  lines.push('</html>');

  return lines.join('\n');
}
