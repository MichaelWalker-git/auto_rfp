import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import PptxGenJS from 'pptxgenjs';

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
import { buildS3Key, CONTENT_TYPES, type ExportRequest, sanitizeFileName, loadDocumentHtmlForExport } from '@/helpers/export';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const PRESIGN_EXPIRES_IN = Number(process.env.PRESIGN_EXPIRES_IN || 3600);

const s3Client = new S3Client({ region: REGION });

// ─── Design tokens ────────────────────────────────────────────────────────────

const THEME = {
  // Indigo brand palette
  primary:     '4338CA',  // indigo-700
  primaryDark: '312E81',  // indigo-900
  accent:      '6366F1',  // indigo-500
  accentLight: 'EEF2FF',  // indigo-50
  // Neutrals
  dark:        '111827',  // gray-900
  body:        '374151',  // gray-700
  muted:       '6B7280',  // gray-500
  border:      'E5E7EB',  // gray-200
  white:       'FFFFFF',
  offWhite:    'F9FAFB',  // gray-50
  // Slide dimensions (LAYOUT_WIDE = 13.33" × 7.5")
  W: 13.33,
  H: 7.5,
};

// ─── HTML parsing helpers ─────────────────────────────────────────────────────

const stripTags = (html: string): string =>
  html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

interface ParsedSection {
  title: string;
  level: 1 | 2 | 3;
  bullets: string[];
  paragraphs: string[];
  tableRows: string[][];
}

/**
 * Parse HTML content into structured sections for slide generation.
 * Splits on h1/h2 headings, extracts bullets and paragraphs.
 */
const parseHtmlToSections = (html: string): ParsedSection[] => {
  if (!html) return [];

  const sections: ParsedSection[] = [];

  // Split on h1 and h2 headings
  const parts = html.split(/(?=<h[12][^>]*>)/i);

  for (const part of parts) {
    if (!part.trim()) continue;

    // Extract heading
    const headingMatch = part.match(/^<h([12])[^>]*>(.*?)<\/h[12]>/i);
    if (!headingMatch) {
      // Content before first heading — skip or treat as intro
      continue;
    }

    const level = parseInt(headingMatch[1], 10) as 1 | 2;
    const title = stripTags(headingMatch[2]).trim();
    const body = part.slice(headingMatch[0].length);

    // Extract bullet points from <li> elements
    const bullets: string[] = [];
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch: RegExpExecArray | null;
    while ((liMatch = liRegex.exec(body)) !== null) {
      const text = stripTags(liMatch[1]).trim();
      if (text) bullets.push(text);
    }

    // Extract paragraphs (excluding list content)
    const bodyWithoutLists = body.replace(/<[uo]l[^>]*>[\s\S]*?<\/[uo]l>/gi, '');
    const paragraphs: string[] = [];
    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    let pMatch: RegExpExecArray | null;
    while ((pMatch = pRegex.exec(bodyWithoutLists)) !== null) {
      const text = stripTags(pMatch[1]).trim();
      if (text && text.length > 10) paragraphs.push(text);
    }

    // Extract table rows
    const tableRows: string[][] = [];
    const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch: RegExpExecArray | null;
    while ((trMatch = trRegex.exec(body)) !== null) {
      const cells: string[] = [];
      const tdRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let tdMatch: RegExpExecArray | null;
      while ((tdMatch = tdRegex.exec(trMatch[1])) !== null) {
        cells.push(stripTags(tdMatch[1]).trim());
      }
      if (cells.length > 0) tableRows.push(cells);
    }

    if (title) {
      sections.push({ title, level, bullets, paragraphs, tableRows });
    }
  }

  return sections;
};

// ─── Slide builders ───────────────────────────────────────────────────────────

const addTitleSlide = (pptx: PptxGenJS, doc: RFPDocumentContent): void => {
  const slide = pptx.addSlide();

  // Full-bleed gradient background via two rectangles
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: THEME.W, h: THEME.H,
    fill: { color: THEME.primaryDark },
    line: { color: THEME.primaryDark },
  });
  // Accent bar on left
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.18, h: THEME.H,
    fill: { color: THEME.accent },
    line: { color: THEME.accent },
  });

  // Document title
  slide.addText(doc.title, {
    x: 0.6, y: 1.6, w: 11.5, h: 2.4,
    fontSize: 40,
    bold: true,
    color: THEME.white,
    align: 'left',
    valign: 'middle',
    wrap: true,
    fontFace: 'Calibri',
  });

  // Divider line
  slide.addShape(pptx.ShapeType.line, {
    x: 0.6, y: 4.2, w: 10, h: 0,
    line: { color: THEME.accent, width: 2 },
  });

  // Metadata row
  const metaParts: string[] = [];
  if (doc.customerName) metaParts.push(`Prepared for: ${doc.customerName}`);
  if (doc.opportunityId) metaParts.push(`Opportunity: ${doc.opportunityId}`);
  metaParts.push(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }));

  slide.addText(metaParts.join('   •   '), {
    x: 0.6, y: 4.5, w: 11.5, h: 0.5,
    fontSize: 14,
    color: 'C7D2FE',  // indigo-200
    align: 'left',
    fontFace: 'Calibri',
  });

  // Confidential footer
  slide.addText('CONFIDENTIAL', {
    x: 0, y: THEME.H - 0.4, w: THEME.W, h: 0.35,
    fontSize: 9,
    color: '818CF8',  // indigo-400
    align: 'center',
    fontFace: 'Calibri',
  });
};

const addAgendaSlide = (pptx: PptxGenJS, sections: ParsedSection[]): void => {
  const slide = pptx.addSlide();
  slide.background = { color: THEME.offWhite };

  // Header bar
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: THEME.W, h: 1.0,
    fill: { color: THEME.primary },
    line: { color: THEME.primary },
  });
  slide.addText('Agenda', {
    x: 0.5, y: 0, w: 12, h: 1.0,
    fontSize: 28, bold: true, color: THEME.white,
    valign: 'middle', fontFace: 'Calibri',
  });

  // Accent left bar
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: 0.12, h: THEME.H,
    fill: { color: THEME.accent },
    line: { color: THEME.accent },
  });

  const h2Sections = sections.filter(s => s.level === 2).slice(0, 10);
  const colCount = h2Sections.length > 5 ? 2 : 1;
  const itemsPerCol = Math.ceil(h2Sections.length / colCount);

  h2Sections.forEach((section, idx) => {
    const col = Math.floor(idx / itemsPerCol);
    const row = idx % itemsPerCol;
    const x = 0.5 + col * 6.4;
    const y = 1.3 + row * 0.58;

    // Number badge
    slide.addShape(pptx.ShapeType.ellipse, {
      x, y: y - 0.02, w: 0.38, h: 0.38,
      fill: { color: THEME.accent },
      line: { color: THEME.accent },
    });
    slide.addText(String(idx + 1), {
      x, y: y - 0.02, w: 0.38, h: 0.38,
      fontSize: 11, bold: true, color: THEME.white,
      align: 'center', valign: 'middle', fontFace: 'Calibri',
    });

    // Section title
    slide.addText(section.title, {
      x: x + 0.48, y, w: colCount === 2 ? 5.6 : 11.5, h: 0.42,
      fontSize: 15, color: THEME.dark,
      valign: 'middle', fontFace: 'Calibri',
    });
  });
};

const addSectionDividerSlide = (pptx: PptxGenJS, title: string, sectionNum: number): void => {
  const slide = pptx.addSlide();

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: THEME.W, h: THEME.H,
    fill: { color: THEME.primary },
    line: { color: THEME.primary },
  });

  // Large section number watermark
  slide.addText(String(sectionNum).padStart(2, '0'), {
    x: 8, y: 0.5, w: 5, h: 6,
    fontSize: 200, bold: true,
    color: THEME.primaryDark,
    align: 'right', valign: 'middle',
    fontFace: 'Calibri',
  });

  // Accent bar
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.5, y: 2.8, w: 0.08, h: 2.0,
    fill: { color: THEME.accent },
    line: { color: THEME.accent },
  });

  slide.addText(title, {
    x: 0.8, y: 2.8, w: 9, h: 2.0,
    fontSize: 36, bold: true, color: THEME.white,
    align: 'left', valign: 'middle', wrap: true,
    fontFace: 'Calibri',
  });
};

const addContentSlide = (
  pptx: PptxGenJS,
  section: ParsedSection,
  sectionNum: number,
): void => {
  const slide = pptx.addSlide();
  slide.background = { color: THEME.white };

  // Top header bar
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: THEME.W, h: 0.85,
    fill: { color: THEME.primary },
    line: { color: THEME.primary },
  });

  // Section number chip
  slide.addShape(pptx.ShapeType.rect, {
    x: 0.3, y: 0.12, w: 0.5, h: 0.6,
    fill: { color: THEME.accent },
    line: { color: THEME.accent },
    rectRadius: 0.06,
  });
  slide.addText(String(sectionNum).padStart(2, '0'), {
    x: 0.3, y: 0.12, w: 0.5, h: 0.6,
    fontSize: 13, bold: true, color: THEME.white,
    align: 'center', valign: 'middle', fontFace: 'Calibri',
  });

  // Section title in header
  slide.addText(section.title, {
    x: 0.95, y: 0, w: 11.8, h: 0.85,
    fontSize: 20, bold: true, color: THEME.white,
    valign: 'middle', fontFace: 'Calibri',
  });

  // Bottom accent line
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: THEME.H - 0.3, w: THEME.W, h: 0.3,
    fill: { color: THEME.accentLight },
    line: { color: THEME.accentLight },
  });

  const contentY = 1.05;
  const contentH = THEME.H - contentY - 0.4;

  if (section.tableRows.length > 1) {
    // Table slide
    const headers = section.tableRows[0];
    const rows = section.tableRows.slice(1).slice(0, 8); // max 8 data rows

    const colW = Math.min(11.5 / headers.length, 3.5);
    const tableData = [
      headers.map(h => ({
        text: h,
        options: { bold: true, color: THEME.white, fill: { color: THEME.primary }, fontSize: 11, fontFace: 'Calibri' },
      })),
      ...rows.map((row, rIdx) =>
        row.map(cell => ({
          text: cell,
          options: {
            color: THEME.body,
            fill: { color: rIdx % 2 === 0 ? THEME.white : THEME.offWhite },
            fontSize: 10,
            fontFace: 'Calibri',
          },
        })),
      ),
    ];

    slide.addTable(tableData, {
      x: 0.4, y: contentY, w: Math.min(colW * headers.length, 12.5),
      colW: headers.map(() => colW),
      border: { type: 'solid', color: THEME.border, pt: 0.5 },
      rowH: 0.38,
    });

  } else if (section.bullets.length > 0) {
    // Bullet slide — up to 2 columns if many bullets
    const bullets = section.bullets.slice(0, 12);
    const useColumns = bullets.length > 5;

    if (useColumns) {
      const half = Math.ceil(bullets.length / 2);
      const col1 = bullets.slice(0, half);
      const col2 = bullets.slice(half);

      [col1, col2].forEach((colBullets, colIdx) => {
        const x = 0.4 + colIdx * 6.4;
        slide.addText(
          colBullets.map(b => ({ text: b.length > 120 ? b.slice(0, 120) + '…' : b, options: {} })),
          {
            x, y: contentY, w: 6.0, h: contentH,
            fontSize: 13,
            color: THEME.body,
            bullet: { type: 'bullet', characterCode: '25CF', indent: 10 },
            paraSpaceAfter: 8,
            valign: 'top',
            fontFace: 'Calibri',
          },
        );
      });
    } else {
      // Add intro paragraph if available
      let yOffset = contentY;
      if (section.paragraphs.length > 0) {
        const intro = section.paragraphs[0].length > 300
          ? section.paragraphs[0].slice(0, 300) + '…'
          : section.paragraphs[0];
        slide.addText(intro, {
          x: 0.4, y: yOffset, w: 12.5, h: 0.9,
          fontSize: 12, color: THEME.muted,
          valign: 'top', wrap: true, fontFace: 'Calibri',
        });
        yOffset += 1.0;
      }

      slide.addText(
        bullets.map(b => ({ text: b.length > 150 ? b.slice(0, 150) + '…' : b, options: {} })),
        {
          x: 0.4, y: yOffset, w: 12.5, h: contentH - (yOffset - contentY),
          fontSize: 14,
          color: THEME.body,
          bullet: { type: 'bullet', characterCode: '25CF', indent: 12 },
          paraSpaceAfter: 10,
          valign: 'top',
          fontFace: 'Calibri',
        },
      );
    }

  } else if (section.paragraphs.length > 0) {
    // Text paragraph slide — show up to 3 paragraphs
    const paras = section.paragraphs.slice(0, 3);
    const combined = paras
      .map(p => (p.length > 400 ? p.slice(0, 400) + '…' : p))
      .join('\n\n');

    slide.addText(combined, {
      x: 0.4, y: contentY, w: 12.5, h: contentH,
      fontSize: 13,
      color: THEME.body,
      valign: 'top',
      wrap: true,
      paraSpaceAfter: 10,
      fontFace: 'Calibri',
    });
  }
};

const addClosingSlide = (pptx: PptxGenJS, doc: RFPDocumentContent): void => {
  const slide = pptx.addSlide();

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: THEME.W, h: THEME.H,
    fill: { color: THEME.primaryDark },
    line: { color: THEME.primaryDark },
  });

  // Decorative circles
  slide.addShape(pptx.ShapeType.ellipse, {
    x: 9.5, y: -1.5, w: 5, h: 5,
    fill: { color: THEME.primary, transparency: 60 },
    line: { color: THEME.primary, transparency: 60 },
  });
  slide.addShape(pptx.ShapeType.ellipse, {
    x: -1, y: 4, w: 4, h: 4,
    fill: { color: THEME.accent, transparency: 70 },
    line: { color: THEME.accent, transparency: 70 },
  });

  slide.addText('Thank You', {
    x: 0, y: 2.2, w: THEME.W, h: 1.6,
    fontSize: 52, bold: true, color: THEME.white,
    align: 'center', valign: 'middle', fontFace: 'Calibri',
  });

  slide.addShape(pptx.ShapeType.rect, {
    x: 4.5, y: 4.1, w: 4.3, h: 0.06,
    fill: { color: THEME.accent },
    line: { color: THEME.accent },
  });

  if (doc.customerName) {
    slide.addText(`Prepared for ${doc.customerName}`, {
      x: 0, y: 4.4, w: THEME.W, h: 0.5,
      fontSize: 16, color: 'C7D2FE',
      align: 'center', fontFace: 'Calibri',
    });
  }

  slide.addText('CONFIDENTIAL', {
    x: 0, y: THEME.H - 0.4, w: THEME.W, h: 0.35,
    fontSize: 9, color: '818CF8',
    align: 'center', fontFace: 'Calibri',
  });
};

// ─── Main builder ─────────────────────────────────────────────────────────────

const buildPptxPresentation = (doc: RFPDocumentContent): PptxGenJS => {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'AutoRFP';
  pptx.title = doc.title;
  pptx.subject = doc.customerName ?? '';

  const sections = parseHtmlToSections(doc.content ?? '');

  // 1. Title slide
  addTitleSlide(pptx, doc);

  // 2. Agenda slide (if there are sections)
  const h2Sections = sections.filter(s => s.level === 2);
  if (h2Sections.length > 1) {
    addAgendaSlide(pptx, sections);
  }

  // 3. Executive summary slide (from outlineSummary)
  if (doc.outlineSummary) {
    addContentSlide(pptx, {
      title: 'Executive Summary',
      level: 2,
      bullets: [],
      paragraphs: [doc.outlineSummary],
      tableRows: [],
    }, 0);
  }

  // 4. Section slides
  let sectionNum = 1;
  for (const section of h2Sections) {
    // Section divider slide
    addSectionDividerSlide(pptx, section.title, sectionNum);
    // Content slide
    addContentSlide(pptx, section, sectionNum);
    sectionNum++;
  }

  // 5. Closing slide
  addClosingSlide(pptx, doc);

  return pptx;
};

// ─── Lambda handler ───────────────────────────────────────────────────────────

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is required' });
    }

    const body: ExportRequest = JSON.parse(event.body);
    const { projectId, proposalId, opportunityId } = body;

    if (!projectId || !proposalId || !opportunityId) {
      return apiResponse(400, { message: 'projectId, proposalId, and opportunityId are required' });
    }

    const rfpDoc = await getRFPDocument(projectId, opportunityId, proposalId);
    if (!rfpDoc || rfpDoc.deletedAt) {
      return apiResponse(404, { message: 'Document not found' });
    }

    const organizationId = rfpDoc.orgId || getOrgId(event) || 'DEFAULT';

    // Load HTML content from S3 (preferred) or inline DynamoDB content
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

    const pptx = buildPptxPresentation(docContent);

    // Generate buffer
    const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer;

    const key = buildS3Key(organizationId, projectId, opportunityId, proposalId, docContent.title, 'pptx');

    await s3Client.send(new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: key,
      Body: pptxBuffer,
      ContentType: CONTENT_TYPES.pptx,
    }));

    const url = await getSignedUrl(s3Client as any, new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: key,
    }), { expiresIn: PRESIGN_EXPIRES_IN });

    setAuditContext(event, {
      action: 'DATA_EXPORTED',
      resource: 'proposal',
      resourceId: proposalId,
    });

    return apiResponse(200, {
      success: true,
      proposal: { id: proposalId, title: docContent.title },
      export: {
        format: 'pptx',
        bucket: DOCUMENTS_BUCKET,
        key,
        url,
        expiresIn: PRESIGN_EXPIRES_IN,
        contentType: CONTENT_TYPES.pptx,
        fileName: `${sanitizeFileName(docContent.title)}.pptx`,
      },
    });
  } catch (err) {
    console.error('Error generating PowerPoint:', err);
    return apiResponse(500, {
      message: 'Failed to generate PowerPoint',
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
