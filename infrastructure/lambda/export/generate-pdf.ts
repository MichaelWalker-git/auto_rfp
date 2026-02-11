import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { getProposal } from '../helpers/proposal';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '../helpers/env';
import { type ProposalDocument } from '@auto-rfp/shared';
import { buildS3Key, CONTENT_TYPES, type ExportRequest, sanitizeFileName } from './export-utils';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const PRESIGN_EXPIRES_IN = Number(process.env.PRESIGN_EXPIRES_IN || 3600);

const s3Client = new S3Client({ region: REGION });

/**
 * Build a PDF buffer from a ProposalDocument using raw PDF construction.
 * We build a minimal valid PDF manually to avoid heavy dependencies in Lambda.
 */
function buildPdfBuffer(doc: ProposalDocument, options?: { pageSize?: 'letter' | 'a4' }): Buffer {
  const pageWidth = options?.pageSize === 'a4' ? 595.28 : 612;
  const pageHeight = options?.pageSize === 'a4' ? 841.89 : 792;
  const margin = 50;
  const maxWidth = pageWidth - margin * 2;
  const lineHeight = 14;
  const titleSize = 20;
  const h2Size = 14;
  const h3Size = 12;
  const textSize = 10;

  // Simple PDF builder
  const objects: string[] = [];
  let objectCount = 0;
  const offsets: number[] = [];

  function addObject(content: string): number {
    objectCount++;
    objects.push(content);
    return objectCount;
  }

  // Approximate character width for Helvetica at given size
  function charWidth(size: number): number {
    return size * 0.5;
  }

  // Word-wrap text to fit within maxWidth
  function wrapText(text: string, fontSize: number): string[] {
    const cw = charWidth(fontSize);
    const maxChars = Math.floor(maxWidth / cw);
    const words = (text || '').split(/\s+/);
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      if (testLine.length > maxChars && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines.length > 0 ? lines : [''];
  }

  // Escape special PDF characters
  function pdfEscape(text: string): string {
    return text
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      // Strip non-ASCII for basic PDF compatibility
      .replace(/[^\x20-\x7E]/g, '');
  }

  // Collect all text operations grouped by page
  interface TextOp {
    text: string;
    x: number;
    y: number;
    fontSize: number;
    bold: boolean;
  }

  const allPages: TextOp[][] = [];
  let currentPageOps: TextOp[] = [];
  let y = pageHeight - margin;

  function ensureSpace(needed: number) {
    if (y - needed < margin) {
      allPages.push(currentPageOps);
      currentPageOps = [];
      y = pageHeight - margin;
    }
  }

  function drawText(text: string, fontSize: number, bold = false) {
    const lines = wrapText(text, fontSize);
    for (const line of lines) {
      ensureSpace(lineHeight + 2);
      currentPageOps.push({
        text: pdfEscape(line),
        x: margin,
        y,
        fontSize,
        bold,
      });
      y -= lineHeight;
    }
    y -= 4; // paragraph spacing
  }

  function drawSpacer(height: number) {
    y -= height;
  }

  // Build content
  drawText(doc.proposalTitle, titleSize, true);
  drawSpacer(8);

  if (doc.customerName) {
    drawText(`Customer: ${doc.customerName}`, textSize);
  }
  if (doc.opportunityId) {
    drawText(`Opportunity ID: ${doc.opportunityId}`, textSize);
  }
  drawText(`Date: ${new Date().toLocaleDateString()}`, textSize);
  drawSpacer(12);

  if (doc.outlineSummary) {
    drawText('Executive Summary', h2Size, true);
    drawSpacer(4);
    const paragraphs = doc.outlineSummary.split('\n\n');
    for (const para of paragraphs) {
      if (para.trim()) drawText(para.trim(), textSize);
    }
    drawSpacer(8);
  }

  doc.sections.forEach((section, sIdx) => {
    drawText(`${sIdx + 1}. ${section.title}`, h2Size, true);
    drawSpacer(4);

    if (section.summary) {
      drawText(section.summary, textSize);
    }

    section.subsections.forEach((sub, subIdx) => {
      drawText(`${sIdx + 1}.${subIdx + 1} ${sub.title}`, h3Size, true);
      drawSpacer(2);

      const paragraphs = (sub.content || '').split('\n\n');
      for (const para of paragraphs) {
        if (para.trim()) drawText(para.trim(), textSize);
      }
    });

    drawSpacer(8);
  });

  // Push last page
  if (currentPageOps.length > 0) {
    allPages.push(currentPageOps);
  }

  // If no content, add empty page
  if (allPages.length === 0) {
    allPages.push([]);
  }

  // Build PDF objects
  // 1: Catalog
  addObject('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');

  // 2: Pages (placeholder, will be updated)
  const pagesObjNum = addObject(''); // placeholder

  // 3: Font - Helvetica
  const fontRegularNum = addObject(`${objectCount + 1} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj`);
  objects[fontRegularNum - 1] = `${fontRegularNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj`;

  // 4: Font - Helvetica-Bold
  const fontBoldNum = addObject(`${objectCount} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj`);
  objects[fontBoldNum - 1] = `${fontBoldNum} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj`;

  // Create page objects
  const pageObjNums: number[] = [];
  for (let i = 0; i < allPages.length; i++) {
    const pageOps = allPages[i]!;

    // Build content stream
    let stream = 'BT\n';
    for (const op of pageOps) {
      const fontRef = op.bold ? '/F2' : '/F1';
      stream += `${fontRef} ${op.fontSize} Tf\n`;
      stream += `${op.x} ${op.y.toFixed(2)} Td\n`;
      stream += `(${op.text}) Tj\n`;
      stream += `${-op.x} ${-op.y.toFixed(2)} Td\n`; // Reset position
    }
    stream += 'ET\n';

    // Content stream object
    const streamNum = addObject(`${objectCount} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj`);
    objects[streamNum - 1] = `${streamNum} 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj`;

    // Page object
    const pageNum = addObject(`${objectCount} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${streamNum} 0 R /Resources << /Font << /F1 ${fontRegularNum} 0 R /F2 ${fontBoldNum} 0 R >> >> >>\nendobj`);
    objects[pageNum - 1] = `${pageNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Contents ${streamNum} 0 R /Resources << /Font << /F1 ${fontRegularNum} 0 R /F2 ${fontBoldNum} 0 R >> >> >>\nendobj`;
    pageObjNums.push(pageNum);
  }

  // Update Pages object
  const kidsStr = pageObjNums.map(n => `${n} 0 R`).join(' ');
  objects[pagesObjNum - 1] = `2 0 obj\n<< /Type /Pages /Kids [${kidsStr}] /Count ${pageObjNums.length} >>\nendobj`;

  // Build final PDF
  let pdf = '%PDF-1.4\n';
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += objects[i] + '\n';
  }

  const xrefOffset = pdf.length;
  pdf += 'xref\n';
  pdf += `0 ${objectCount + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (let i = 0; i < objectCount; i++) {
    pdf += `${offsets[i]!.toString().padStart(10, '0')} 00000 n \n`;
  }

  pdf += 'trailer\n';
  pdf += `<< /Size ${objectCount + 1} /Root 1 0 R >>\n`;
  pdf += 'startxref\n';
  pdf += `${xrefOffset}\n`;
  pdf += '%%EOF\n';

  return Buffer.from(pdf, 'binary');
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is required' });
    }

    const body: ExportRequest = JSON.parse(event.body);
    const { projectId, proposalId, opportunityId, options } = body;

    if (!projectId || !proposalId || !opportunityId) {
      return apiResponse(400, { message: 'projectId, proposalId, and opportunityId are required' });
    }

    const proposal = await getProposal(projectId, proposalId);
    if (!proposal) {
      return apiResponse(404, { message: 'Proposal not found' });
    }

    const organizationId = proposal.organizationId || getOrgId(event) || 'DEFAULT';
    const pdfBuffer = buildPdfBuffer(proposal.document, { pageSize: options?.pageSize });

    const key = buildS3Key(organizationId, projectId, opportunityId, proposalId, proposal.document.proposalTitle, 'pdf');

    await s3Client.send(new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: key,
      Body: pdfBuffer,
      ContentType: CONTENT_TYPES.pdf,
    }));

    const url = await getSignedUrl(s3Client as any, new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: key,
    }), { expiresIn: PRESIGN_EXPIRES_IN });

    return apiResponse(200, {
      success: true,
      proposal: { id: proposal.id, title: proposal.document.proposalTitle },
      export: {
        format: 'pdf',
        bucket: DOCUMENTS_BUCKET,
        key,
        url,
        expiresIn: PRESIGN_EXPIRES_IN,
        contentType: CONTENT_TYPES.pdf,
        fileName: `${sanitizeFileName(proposal.document.proposalTitle)}.pdf`,
      },
    });
  } catch (err) {
    console.error('Error generating PDF:', err);
    return apiResponse(500, {
      message: 'Failed to generate PDF',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:export'))
    .use(httpErrorMiddleware()),
);