import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  HorizontalPositionAlign,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  UnderlineType,
  VerticalAlign,
  WidthType,
} from 'docx';

import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getRFPDocument } from '@/helpers/rfp-document';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import middy from '@middy/core';
import { requireEnv } from '@/helpers/env';
import { type RFPDocumentContent } from '@auto-rfp/core';
import { loadDocumentHtmlForExport } from '@/helpers/export';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const PRESIGN_EXPIRES_IN = Number(process.env.PRESIGN_EXPIRES_IN || 3600);

const s3Client = new S3Client({ region: REGION });

// ─── Design tokens (matching app's indigo palette) ────────────────────────────

const COLORS = {
  primary:    '4338CA',  // indigo-700
  accent:     '6366F1',  // indigo-500
  dark:       '111827',  // gray-900
  body:       '374151',  // gray-700
  muted:      '6B7280',  // gray-500
  border:     'E5E7EB',  // gray-200
  headerBg:   'EEF2FF',  // indigo-50
  white:      'FFFFFF',
  tableHead:  '4338CA',  // indigo-700
  tableAlt:   'F9FAFB',  // gray-50
};

const FONTS = {
  heading: 'Calibri',
  body:    'Calibri',
};

// EMU conversions (1 inch = 914400 EMU, 1 pt = 12700 EMU)
const PT = (pt: number) => pt * 12700;
const TWIP = (pt: number) => pt * 20; // twips = pt * 20

// Base font size for all body text — 11pt = 22 half-points
const BASE_SIZE = TWIP(11);

/** Create a consistent base TextRun with overrides */
const run = (text: string, opts: Partial<{
  bold: boolean; italics: boolean; strike: boolean;
  underline: { type: UnderlineType };
  color: string; size: number; font: string;
  shading: { type: ShadingType; color: string; fill: string };
}> = {}): TextRun => new TextRun({
  text,
  font: opts.font ?? FONTS.body,
  size: opts.size ?? BASE_SIZE,
  color: opts.color ?? COLORS.body,
  bold: opts.bold,
  italics: opts.italics,
  strike: opts.strike,
  underline: opts.underline,
  shading: opts.shading,
});

// ─── HTML parsing ─────────────────────────────────────────────────────────────

const decodeHtmlEntities = (text: string): string =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ');

const stripAllTags = (html: string): string =>
  decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  ).trim();

/**
 * Parse inline HTML (within a paragraph) into TextRun objects.
 * All runs use BASE_SIZE (11pt) for consistent sizing.
 * Handles <strong>, <em>, <u>, <s>, <code>, <a>, <span>, and plain text.
 */
const parseInlineHtml = (html: string): TextRun[] => {
  const runs: TextRun[] = [];
  const tokenRegex = /<(strong|b|em|i|u|s|strike|code|a|span)[^>]*>([\s\S]*?)<\/\1>|([^<]+)/gi;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(html)) !== null) {
    const tag = match[1]?.toLowerCase();
    const inner = match[2] ?? '';
    const plain = match[3] ?? '';

    if (plain) {
      const text = decodeHtmlEntities(plain.replace(/<br\s*\/?>/gi, '\n'));
      if (text.trim() || text.includes('\n')) {
        runs.push(run(text));
      }
    } else if (tag === 'strong' || tag === 'b') {
      const text = stripAllTags(inner);
      if (text) runs.push(run(text, { bold: true, color: COLORS.dark }));
    } else if (tag === 'em' || tag === 'i') {
      const text = stripAllTags(inner);
      if (text) runs.push(run(text, { italics: true }));
    } else if (tag === 'u') {
      const text = stripAllTags(inner);
      if (text) runs.push(run(text, { underline: { type: UnderlineType.SINGLE } }));
    } else if (tag === 's' || tag === 'strike') {
      const text = stripAllTags(inner);
      if (text) runs.push(run(text, { strike: true }));
    } else if (tag === 'code') {
      const text = stripAllTags(inner);
      if (text) runs.push(run(text, {
        font: 'Courier New',
        size: TWIP(10),
        color: '1F2937',
        shading: { type: ShadingType.SOLID, color: 'F3F4F6', fill: 'F3F4F6' },
      }));
    } else if (tag === 'a') {
      const text = stripAllTags(inner);
      if (text) runs.push(run(text, { color: COLORS.accent, underline: { type: UnderlineType.SINGLE } }));
    } else if (tag === 'span') {
      runs.push(...parseInlineHtml(inner));
    }
  }

  // Fallback: strip all tags and return as plain run
  if (runs.length === 0) {
    const text = decodeHtmlEntities(html.replace(/<[^>]+>/g, ''));
    if (text.trim()) runs.push(run(text));
  }

  return runs;
};

// ─── Document element builders ────────────────────────────────────────────────

const makeCoverPage = (doc: RFPDocumentContent): Paragraph[] => {
  const paras: Paragraph[] = [];

  // Spacer
  paras.push(new Paragraph({ spacing: { before: TWIP(72) } }));

  // Title
  paras.push(new Paragraph({
    children: [new TextRun({
      text: doc.title,
      bold: true,
      size: TWIP(32),
      color: COLORS.primary,
      font: FONTS.heading,
    })],
    spacing: { before: TWIP(48), after: TWIP(12) },
    border: { bottom: { style: BorderStyle.THICK, size: 6, color: COLORS.accent, space: 4 } },
  }));

  // Subtitle / customer
  if (doc.customerName) {
    paras.push(new Paragraph({
      children: [
        new TextRun({ text: 'Prepared for: ', bold: true, size: TWIP(13), color: COLORS.muted, font: FONTS.body }),
        new TextRun({ text: doc.customerName, size: TWIP(13), color: COLORS.dark, font: FONTS.body }),
      ],
      spacing: { before: TWIP(16), after: TWIP(6) },
    }));
  }

  if (doc.opportunityId) {
    paras.push(new Paragraph({
      children: [
        new TextRun({ text: 'Opportunity ID: ', bold: true, size: TWIP(13), color: COLORS.muted, font: FONTS.body }),
        new TextRun({ text: doc.opportunityId, size: TWIP(13), color: COLORS.dark, font: FONTS.body }),
      ],
      spacing: { after: TWIP(6) },
    }));
  }

  paras.push(new Paragraph({
    children: [
      new TextRun({ text: 'Date: ', bold: true, size: TWIP(13), color: COLORS.muted, font: FONTS.body }),
      new TextRun({ text: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), size: TWIP(13), color: COLORS.dark, font: FONTS.body }),
    ],
    spacing: { after: TWIP(6) },
  }));

  paras.push(new Paragraph({
    children: [new TextRun({ text: 'CONFIDENTIAL', bold: true, size: TWIP(10), color: COLORS.muted, font: FONTS.body })],
    spacing: { before: TWIP(24) },
  }));

  // Page break after cover
  paras.push(new Paragraph({ children: [new PageBreak()] }));

  return paras;
};

const makeHeading = (text: string, level: 1 | 2 | 3 | 4): Paragraph => {
  const configs = {
    1: { size: TWIP(22), color: COLORS.primary, bold: true, before: TWIP(24), after: TWIP(8), border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.accent, space: 4 } } },
    2: { size: TWIP(18), color: COLORS.primary, bold: true, before: TWIP(20), after: TWIP(6), border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: COLORS.border, space: 3 } } },
    3: { size: TWIP(14), color: COLORS.dark, bold: true, before: TWIP(14), after: TWIP(4), border: undefined },
    4: { size: TWIP(12), color: COLORS.dark, bold: true, before: TWIP(10), after: TWIP(4), border: undefined },
  };
  const cfg = configs[level];

  return new Paragraph({
    children: [new TextRun({ text, bold: cfg.bold, size: cfg.size, color: cfg.color, font: FONTS.heading })],
    spacing: { before: cfg.before, after: cfg.after },
    ...(cfg.border ? { border: cfg.border } : {}),
  });
};

const makeParagraph = (html: string, options: { justified?: boolean; indent?: boolean } = {}): Paragraph => {
  const runs = parseInlineHtml(html);
  return new Paragraph({
    children: runs,
    spacing: { after: TWIP(8), line: 276, lineRule: 'auto' as any },
    alignment: options.justified ? AlignmentType.JUSTIFIED : AlignmentType.LEFT,
    indent: options.indent ? { left: TWIP(18) } : undefined,
  });
};

const makeBullet = (html: string, level = 0): Paragraph => {
  const runs = parseInlineHtml(html);
  return new Paragraph({
    children: runs,
    bullet: { level },
    spacing: { after: TWIP(4) },
  });
};

const makeOrderedItem = (html: string, num: number): Paragraph => {
  const runs = parseInlineHtml(html);
  return new Paragraph({
    children: [
      new TextRun({ text: `${num}. `, bold: true, font: FONTS.body, size: TWIP(11), color: COLORS.primary }),
      ...runs,
    ],
    spacing: { after: TWIP(4) },
    indent: { left: TWIP(18) },
  });
};

const makeBlockquote = (html: string): Paragraph => {
  const runs = parseInlineHtml(html);
  return new Paragraph({
    children: runs,
    spacing: { before: TWIP(8), after: TWIP(8) },
    indent: { left: TWIP(36) },
    border: { left: { style: BorderStyle.THICK, size: 6, color: COLORS.accent, space: 8 } },
    shading: { type: ShadingType.SOLID, color: 'EEF2FF', fill: 'EEF2FF' },
  });
};

const makeHorizontalRule = (): Paragraph =>
  new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: COLORS.border, space: 4 } },
    spacing: { before: TWIP(12), after: TWIP(12) },
  });

const makeTable = (rows: string[][]): Table => {
  const colCount = Math.max(...rows.map(r => r.length));
  const colWidth = Math.floor(9000 / colCount); // total ~9000 twips for content area

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    margins: { top: TWIP(3), bottom: TWIP(3), left: TWIP(6), right: TWIP(6) },
    rows: rows.map((row, rowIdx) =>
      new TableRow({
        tableHeader: rowIdx === 0,
        children: row.map((cell, colIdx) => {
          const isHeader = rowIdx === 0;
          const isAlt = !isHeader && rowIdx % 2 === 0;
          return new TableCell({
            width: { size: colWidth, type: WidthType.DXA },
            verticalAlign: VerticalAlign.CENTER,
            shading: isHeader
              ? { type: ShadingType.SOLID, color: COLORS.tableHead, fill: COLORS.tableHead }
              : isAlt
                ? { type: ShadingType.SOLID, color: COLORS.tableAlt, fill: COLORS.tableAlt }
                : { type: ShadingType.SOLID, color: COLORS.white, fill: COLORS.white },
            borders: {
              top: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border },
              bottom: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border },
              left: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border },
              right: { style: BorderStyle.SINGLE, size: 1, color: COLORS.border },
            },
            children: [new Paragraph({
              children: [new TextRun({
                text: stripAllTags(cell),
                bold: isHeader,
                color: isHeader ? COLORS.white : COLORS.body,
                size: TWIP(isHeader ? 11 : 10),
                font: FONTS.body,
              })],
              spacing: { before: TWIP(2), after: TWIP(2) },
            })],
          });
        }),
      }),
    ),
  });
};

// ─── HTML → DOCX elements parser ─────────────────────────────────────────────

type DocxElement = Paragraph | Table;

const parseHtmlToDocxElements = (html: string): DocxElement[] => {
  if (!html) return [];

  const elements: DocxElement[] = [];
  let pos = 0;

  // Ordered list counter tracking
  const olCounters: number[] = [0];

  const consumeTag = (tagName: string): { content: string; end: number } | null => {
    const openRe = new RegExp(`<${tagName}[^>]*>`, 'i');
    const closeRe = new RegExp(`</${tagName}>`, 'i');
    const openMatch = openRe.exec(html.slice(pos));
    if (!openMatch) return null;

    const start = pos + openMatch.index + openMatch[0].length;
    let depth = 1;
    let i = start;

    while (i < html.length && depth > 0) {
      const nextOpen = html.indexOf(`<${tagName}`, i);
      const nextClose = html.indexOf(`</${tagName}>`, i);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        i = nextOpen + 1;
      } else {
        depth--;
        if (depth === 0) {
          return { content: html.slice(start, nextClose), end: nextClose + `</${tagName}>`.length };
        }
        i = nextClose + 1;
      }
    }
    return null;
  };

  // Use a simpler sequential parser
  const blockRegex = /<(h[1-6]|p|ul|ol|li|table|blockquote|div|hr|pre)[^>]*>([\s\S]*?)<\/\1>|<hr\s*\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = blockRegex.exec(html)) !== null) {
    const tag = match[1]?.toLowerCase() ?? 'hr';
    const content = match[2] ?? '';

    if (tag === 'hr') {
      elements.push(makeHorizontalRule());
      continue;
    }

    if (tag === 'h1') elements.push(makeHeading(stripAllTags(content), 1));
    else if (tag === 'h2') elements.push(makeHeading(stripAllTags(content), 2));
    else if (tag === 'h3') elements.push(makeHeading(stripAllTags(content), 3));
    else if (tag === 'h4' || tag === 'h5' || tag === 'h6') elements.push(makeHeading(stripAllTags(content), 4));
    else if (tag === 'blockquote') elements.push(makeBlockquote(content));
    else if (tag === 'pre') {
      elements.push(new Paragraph({
        children: [new TextRun({ text: stripAllTags(content), font: 'Courier New', size: TWIP(10), color: '1F2937' })],
        shading: { type: ShadingType.SOLID, color: 'F3F4F6', fill: 'F3F4F6' },
        spacing: { before: TWIP(8), after: TWIP(8) },
        indent: { left: TWIP(18) },
      }));
    }
    else if (tag === 'ul') {
      // Extract <li> items
      const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch: RegExpExecArray | null;
      while ((liMatch = liRegex.exec(content)) !== null) {
        elements.push(makeBullet(liMatch[1], 0));
      }
    }
    else if (tag === 'ol') {
      const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
      let liMatch: RegExpExecArray | null;
      let num = 1;
      while ((liMatch = liRegex.exec(content)) !== null) {
        elements.push(makeOrderedItem(liMatch[1], num++));
      }
    }
    else if (tag === 'table') {
      // Extract rows and cells
      const rows: string[][] = [];
      const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let trMatch: RegExpExecArray | null;
      while ((trMatch = trRegex.exec(content)) !== null) {
        const cells: string[] = [];
        const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
        let tdMatch: RegExpExecArray | null;
        while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
          cells.push(tdMatch[1]);
        }
        if (cells.length > 0) rows.push(cells);
      }
      if (rows.length > 0) {
        elements.push(makeTable(rows));
        elements.push(new Paragraph({ spacing: { after: TWIP(8) } })); // spacer after table
      }
    }
    else if (tag === 'div') {
      // Recurse into divs (callout boxes etc.)
      const inner = parseHtmlToDocxElements(content);
      elements.push(...inner);
    }
    else if (tag === 'p') {
      const trimmed = content.trim();
      if (trimmed) {
        elements.push(makeParagraph(trimmed, { justified: true }));
      }
    }
  }

  return elements;
};

// ─── Main document builder ────────────────────────────────────────────────────

const buildWordDocument = (doc: RFPDocumentContent): Document => {
  const children: DocxElement[] = [];

  // Cover page
  children.push(...makeCoverPage(doc));

  // Executive summary (from outlineSummary metadata)
  if (doc.outlineSummary) {
    children.push(makeHeading('Executive Summary', 2));
    children.push(makeParagraph(doc.outlineSummary, { justified: true }));
    children.push(new Paragraph({ spacing: { after: TWIP(12) } }));
  }

  // Main HTML content
  if (doc.content) {
    const parsed = parseHtmlToDocxElements(doc.content);
    children.push(...parsed);
  }

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: FONTS.body, size: TWIP(11), color: COLORS.body },
          paragraph: { spacing: { line: 276, lineRule: 'auto' as any } },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          run: { bold: true, size: TWIP(22), color: COLORS.primary, font: FONTS.heading },
          paragraph: { spacing: { before: TWIP(24), after: TWIP(8) } },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          run: { bold: true, size: TWIP(18), color: COLORS.primary, font: FONTS.heading },
          paragraph: { spacing: { before: TWIP(20), after: TWIP(6) } },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          run: { bold: true, size: TWIP(14), color: COLORS.dark, font: FONTS.heading },
          paragraph: { spacing: { before: TWIP(14), after: TWIP(4) } },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: TWIP(72),    // 1 inch
              bottom: TWIP(72),
              left: TWIP(90),   // 1.25 inch
              right: TWIP(90),
            },
          },
        },
        children,
      },
    ],
  });
};

// ─── Lambda handler ───────────────────────────────────────────────────────────

interface WordExportRequest {
  projectId: string;
  proposalId?: string;
  opportunityId: string;
  documentId?: string;
  options?: {
    pageLimitsPerSection?: number;
    includeCitations?: boolean;
  };
}

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is required' });
    }

    const body: WordExportRequest = JSON.parse(event.body);
    const { projectId, proposalId, opportunityId, documentId } = body;

    if (!projectId || !opportunityId) {
      return apiResponse(400, { message: 'projectId and opportunityId are required' });
    }
    if (!documentId && !proposalId) {
      return apiResponse(400, { message: 'documentId or proposalId is required' });
    }

    const effectiveDocumentId = documentId || proposalId!;

    const rfpDoc = await getRFPDocument(projectId, opportunityId, effectiveDocumentId);
    if (!rfpDoc || rfpDoc.deletedAt) {
      return apiResponse(404, { message: 'Document not found' });
    }

    const organizationId = rfpDoc.orgId || getOrgId(event) || 'DEFAULT';

    // Load HTML from S3 (preferred) with S3 image keys resolved to presigned URLs
    let htmlContent = '';
    if (rfpDoc.htmlContentKey) {
      htmlContent = await loadDocumentHtmlForExport(rfpDoc as Record<string, unknown>);
    } else if ((rfpDoc.content as any)?.content) {
      htmlContent = (rfpDoc.content as any).content;
    }

    const docContent: RFPDocumentContent = {
      title: rfpDoc.title ?? rfpDoc.name ?? 'Proposal',
      customerName: (rfpDoc.content as any)?.customerName ?? null,
      opportunityId: (rfpDoc.content as any)?.opportunityId ?? null,
      outlineSummary: (rfpDoc.content as any)?.outlineSummary ?? null,
      content: htmlContent,
    };

    // Build the Word document
    const wordDoc = buildWordDocument(docContent);
    const wordBuffer = await Packer.toBuffer(wordDoc);

    // Upload to S3
    const sanitizedTitle = (docContent.title || 'proposal').replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 160);
    const key = `${organizationId}/${projectId}/${opportunityId}/${effectiveDocumentId}/${sanitizedTitle}.docx`;

    await s3Client.send(new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: key,
      Body: wordBuffer,
      ContentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }));

    const url = await getSignedUrl(s3Client as any, new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: key,
    }), { expiresIn: PRESIGN_EXPIRES_IN });

    setAuditContext(event, {
      action: 'DATA_EXPORTED',
      resource: 'proposal',
      resourceId: effectiveDocumentId,
    });

    return apiResponse(200, {
      success: true,
      document: { id: rfpDoc.documentId, title: docContent.title },
      export: {
        format: 'docx',
        bucket: DOCUMENTS_BUCKET,
        key,
        url,
        expiresIn: PRESIGN_EXPIRES_IN,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        fileName: `${sanitizedTitle}.docx`,
      },
    });
  } catch (err) {
    console.error('Error generating Word document:', err);
    return apiResponse(500, {
      message: 'Failed to generate Word document',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:export'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
