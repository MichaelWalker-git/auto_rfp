import { type ProposalDocument } from '@auto-rfp/shared';

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
  proposalTitle: string,
  format: ExportFormat,
): string {
  const sanitized = sanitizeFileName(proposalTitle);
  return `${organizationId}/${projectId}/${opportunityId}/${proposalId}/${sanitized}${FILE_EXTENSIONS[format]}`;
}

/**
 * Flatten proposal document into plain text sections for use by various exporters.
 */
export function flattenProposalToText(doc: ProposalDocument): string {
  const lines: string[] = [];

  lines.push(doc.proposalTitle);
  lines.push('='.repeat(doc.proposalTitle.length));
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

  doc.sections.forEach((section, sIdx) => {
    lines.push(`${sIdx + 1}. ${section.title}`);
    lines.push('-'.repeat(`${sIdx + 1}. ${section.title}`.length));
    lines.push('');

    if (section.summary) {
      lines.push(section.summary);
      lines.push('');
    }

    section.subsections.forEach((sub, subIdx) => {
      lines.push(`${sIdx + 1}.${subIdx + 1} ${sub.title}`);
      lines.push('');
      lines.push(sub.content || '');
      lines.push('');
    });
  });

  return lines.join('\n');
}

/**
 * Convert proposal document to Markdown format.
 */
export function proposalToMarkdown(doc: ProposalDocument): string {
  const lines: string[] = [];

  lines.push(`# ${doc.proposalTitle}`);
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

  // Table of Contents
  lines.push('## Table of Contents');
  lines.push('');
  if (doc.outlineSummary) {
    lines.push('- [Executive Summary](#executive-summary)');
  }
  doc.sections.forEach((section, sIdx) => {
    const anchor = section.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    lines.push(`- [${sIdx + 1}. ${section.title}](#${sIdx + 1}-${anchor})`);
    section.subsections.forEach((sub, subIdx) => {
      const subAnchor = sub.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      lines.push(`  - [${sIdx + 1}.${subIdx + 1} ${sub.title}](#${sIdx + 1}${subIdx + 1}-${subAnchor})`);
    });
  });
  lines.push('');
  lines.push('---');
  lines.push('');

  if (doc.outlineSummary) {
    lines.push('## Executive Summary');
    lines.push('');
    lines.push(doc.outlineSummary);
    lines.push('');
  }

  doc.sections.forEach((section, sIdx) => {
    lines.push(`## ${sIdx + 1}. ${section.title}`);
    lines.push('');

    if (section.summary) {
      lines.push(`*${section.summary}*`);
      lines.push('');
    }

    section.subsections.forEach((sub, subIdx) => {
      lines.push(`### ${sIdx + 1}.${subIdx + 1} ${sub.title}`);
      lines.push('');
      lines.push(sub.content || '');
      lines.push('');
    });
  });

  return lines.join('\n');
}

/**
 * Convert proposal document to HTML format.
 */
export function proposalToHtml(doc: ProposalDocument): string {
  const escapeHtml = (text: string): string =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');

  const nl2br = (text: string): string =>
    escapeHtml(text).replace(/\n\n/g, '</p><p>').replace(/\n/g, '<br/>');

  const lines: string[] = [];

  lines.push('<!DOCTYPE html>');
  lines.push('<html lang="en">');
  lines.push('<head>');
  lines.push('  <meta charset="UTF-8">');
  lines.push('  <meta name="viewport" content="width=device-width, initial-scale=1.0">');
  lines.push(`  <title>${escapeHtml(doc.proposalTitle)}</title>`);
  lines.push('  <style>');
  lines.push('    body { font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif; max-width: 900px; margin: 0 auto; padding: 40px 20px; color: #333; line-height: 1.6; }');
  lines.push('    h1 { color: #1a365d; border-bottom: 3px solid #2b6cb0; padding-bottom: 12px; margin-top: 0; }');
  lines.push('    h2 { color: #2b6cb0; border-bottom: 1px solid #e2e8f0; padding-bottom: 8px; margin-top: 32px; }');
  lines.push('    h3 { color: #4a5568; margin-top: 24px; }');
  lines.push('    .metadata { color: #718096; font-size: 0.95em; margin-bottom: 24px; }');
  lines.push('    .metadata span { display: inline-block; margin-right: 24px; }');
  lines.push('    .summary { background: #f7fafc; border-left: 4px solid #2b6cb0; padding: 16px 20px; margin: 20px 0; border-radius: 0 4px 4px 0; }');
  lines.push('    .section { margin-bottom: 32px; }');
  lines.push('    .section-summary { font-style: italic; color: #4a5568; margin-bottom: 16px; }');
  lines.push('    .subsection { margin-left: 16px; margin-bottom: 20px; }');
  lines.push('    .subsection-content { text-align: justify; }');
  lines.push('    .toc { background: #f7fafc; padding: 20px 24px; border-radius: 8px; margin: 24px 0; }');
  lines.push('    .toc h2 { margin-top: 0; border: none; }');
  lines.push('    .toc ul { list-style: none; padding-left: 0; }');
  lines.push('    .toc li { padding: 4px 0; }');
  lines.push('    .toc a { color: #2b6cb0; text-decoration: none; }');
  lines.push('    .toc a:hover { text-decoration: underline; }');
  lines.push('    .toc .sub-item { padding-left: 24px; }');
  lines.push('    @media print { body { max-width: 100%; padding: 20px; } .toc { page-break-after: always; } .section { page-break-inside: avoid; } }');
  lines.push('  </style>');
  lines.push('</head>');
  lines.push('<body>');

  // Header
  lines.push(`  <h1>${escapeHtml(doc.proposalTitle)}</h1>`);
  lines.push('  <div class="metadata">');
  if (doc.customerName) {
    lines.push(`    <span><strong>Customer:</strong> ${escapeHtml(doc.customerName)}</span>`);
  }
  if (doc.opportunityId) {
    lines.push(`    <span><strong>Opportunity ID:</strong> ${escapeHtml(doc.opportunityId)}</span>`);
  }
  lines.push(`    <span><strong>Date:</strong> ${new Date().toLocaleDateString()}</span>`);
  lines.push('  </div>');

  // Table of Contents
  lines.push('  <div class="toc">');
  lines.push('    <h2>Table of Contents</h2>');
  lines.push('    <ul>');
  if (doc.outlineSummary) {
    lines.push('      <li><a href="#executive-summary">Executive Summary</a></li>');
  }
  doc.sections.forEach((section, sIdx) => {
    const anchor = `section-${sIdx + 1}`;
    lines.push(`      <li><a href="#${anchor}">${sIdx + 1}. ${escapeHtml(section.title)}</a></li>`);
    section.subsections.forEach((sub, subIdx) => {
      const subAnchor = `section-${sIdx + 1}-${subIdx + 1}`;
      lines.push(`      <li class="sub-item"><a href="#${subAnchor}">${sIdx + 1}.${subIdx + 1} ${escapeHtml(sub.title)}</a></li>`);
    });
  });
  lines.push('    </ul>');
  lines.push('  </div>');

  // Executive Summary
  if (doc.outlineSummary) {
    lines.push('  <div id="executive-summary" class="summary">');
    lines.push('    <h2>Executive Summary</h2>');
    lines.push(`    <p>${nl2br(doc.outlineSummary)}</p>`);
    lines.push('  </div>');
  }

  // Sections
  doc.sections.forEach((section, sIdx) => {
    const anchor = `section-${sIdx + 1}`;
    lines.push(`  <div id="${anchor}" class="section">`);
    lines.push(`    <h2>${sIdx + 1}. ${escapeHtml(section.title)}</h2>`);

    if (section.summary) {
      lines.push(`    <p class="section-summary">${nl2br(section.summary)}</p>`);
    }

    section.subsections.forEach((sub, subIdx) => {
      const subAnchor = `section-${sIdx + 1}-${subIdx + 1}`;
      lines.push(`    <div id="${subAnchor}" class="subsection">`);
      lines.push(`      <h3>${sIdx + 1}.${subIdx + 1} ${escapeHtml(sub.title)}</h3>`);
      lines.push(`      <div class="subsection-content"><p>${nl2br(sub.content || '')}</p></div>`);
      lines.push('    </div>');
    });

    lines.push('  </div>');
  });

  lines.push('</body>');
  lines.push('</html>');

  return lines.join('\n');
}