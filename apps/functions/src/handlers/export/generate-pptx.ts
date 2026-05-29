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
} from '@/middleware/rbac-middleware';
import middy from '@middy/core';
import { requireEnv } from '@/helpers/env';
import { type RFPDocumentContent } from '@auto-rfp/core';
import { buildS3Key, CONTENT_TYPES, type ExportRequest, sanitizeFileName } from './export-utils';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const PRESIGN_EXPIRES_IN = Number(process.env.PRESIGN_EXPIRES_IN || 3600);

const s3Client = new S3Client({ region: REGION });

const COLORS = {
  primary: '1a365d',
  secondary: '2b6cb0',
  text: '333333',
  lightText: '718096',
  white: 'FFFFFF',
  lightBg: 'F7FAFC',
};

function buildPptxPresentation(doc: RFPDocumentContent): PptxGenJS {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'AutoRFP';
  pptx.title = doc.title;

  // Title slide
  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: COLORS.primary };
  titleSlide.addText(doc.title, {
    x: 0.8,
    y: 1.5,
    w: '85%',
    h: 2,
    fontSize: 36,
    bold: true,
    color: COLORS.white,
    align: 'left',
    valign: 'middle',
  });

  if (doc.customerName) {
    titleSlide.addText(`Prepared for: ${doc.customerName}`, {
      x: 0.8,
      y: 3.8,
      w: '85%',
      fontSize: 18,
      color: COLORS.white,
      align: 'left',
    });
  }

  titleSlide.addText(new Date().toLocaleDateString(), {
    x: 0.8,
    y: 4.5,
    w: '85%',
    fontSize: 14,
    color: COLORS.white,
    align: 'left',
  });

  // Table of Contents slide
  const tocSlide = pptx.addSlide();
  tocSlide.addText('Table of Contents', {
    x: 0.5,
    y: 0.3,
    w: '90%',
    fontSize: 28,
    bold: true,
    color: COLORS.primary,
  });

  const tocItems: string[] = [];
  if (doc.outlineSummary) {
    tocItems.push('Executive Summary');
  }
  // No legacy sections — TOC is derived from htmlContent headings
  if (doc.content) {
    const h2Matches = [...doc.content.matchAll(/<h2[^>]*>(.*?)<\/h2>/gi)];
    h2Matches.forEach((m, idx) => {
      tocItems.push(`${idx + 1}. ${m[1]?.replace(/<[^>]+>/g, '') ?? ''}`);
    });
  }

  tocSlide.addText(
    tocItems.map((item, idx) => ({
      text: item,
      options: {
        fontSize: 16,
        color: COLORS.text,
        bullet: { type: 'number' as const, startAt: idx + 1 },
        paraSpaceAfter: 8,
      },
    })),
    {
      x: 0.8,
      y: 1.2,
      w: '80%',
      h: 5,
      valign: 'top',
    },
  );

  // Executive Summary slide
  if (doc.outlineSummary) {
    const summarySlide = pptx.addSlide();
    summarySlide.addText('Executive Summary', {
      x: 0.5,
      y: 0.3,
      w: '90%',
      fontSize: 28,
      bold: true,
      color: COLORS.primary,
    });

    // Truncate summary for slide readability
    const summaryText = doc.outlineSummary.length > 1200
      ? doc.outlineSummary.substring(0, 1200) + '...'
      : doc.outlineSummary;

    summarySlide.addText(summaryText, {
      x: 0.5,
      y: 1.2,
      w: '90%',
      h: 5,
      fontSize: 14,
      color: COLORS.text,
      valign: 'top',
      align: 'left',
    });
  }

  // Section slides — derived from htmlContent h2/h3 headings
  if (doc.content) {
    // Split htmlContent into h2 sections
    const sectionRegex = /<h2[^>]*>(.*?)<\/h2>([\s\S]*?)(?=<h2|$)/gi;
    let sectionMatch: RegExpExecArray | null;
    let sIdx = 0;
    while ((sectionMatch = sectionRegex.exec(doc.content)) !== null) {
      const sectionTitle = (sectionMatch[1] ?? '').replace(/<[^>]+>/g, '').trim();
      const sectionBody = (sectionMatch[2] ?? '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

      const sectionTitleSlide = pptx.addSlide();
      sectionTitleSlide.background = { color: COLORS.secondary };
      sectionTitleSlide.addText(`${sIdx + 1}. ${sectionTitle}`, {
        x: 0.8, y: 2, w: '85%', h: 2,
        fontSize: 32, bold: true, color: COLORS.white, align: 'left', valign: 'middle',
      });

      if (sectionBody) {
        const contentSlide = pptx.addSlide();
        contentSlide.addText(sectionTitle, {
          x: 0.5, y: 0.3, w: '90%', fontSize: 24, bold: true, color: COLORS.primary,
        });
        const truncated = sectionBody.length > 1500 ? sectionBody.substring(0, 1500) + '...' : sectionBody;
        contentSlide.addText(truncated, {
          x: 0.5, y: 1.2, w: '90%', h: 5,
          fontSize: 12, color: COLORS.text, valign: 'top', align: 'left',
        });
      }
      sIdx++;
    }
  }

  // Thank you / closing slide
  const closingSlide = pptx.addSlide();
  closingSlide.background = { color: COLORS.primary };
  closingSlide.addText('Thank You', {
    x: 0,
    y: 2,
    w: '100%',
    h: 2,
    fontSize: 40,
    bold: true,
    color: COLORS.white,
    align: 'center',
    valign: 'middle',
  });

  if (doc.customerName) {
    closingSlide.addText(`Prepared for ${doc.customerName}`, {
      x: 0,
      y: 4.2,
      w: '100%',
      fontSize: 18,
      color: COLORS.white,
      align: 'center',
    });
  }

  return pptx;
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
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
    if (!rfpDoc || rfpDoc.deletedAt) { return apiResponse(404, { message: 'Document not found' }); }
    if (!rfpDoc.content) { return apiResponse(400, { message: 'Document has no structured content' }); }
    const proposal = { id: rfpDoc.documentId, organizationId: rfpDoc.orgId, document: rfpDoc.content as any };

    const organizationId = proposal.organizationId || getOrgId(event) || 'DEFAULT';
    const pptx = buildPptxPresentation(proposal.document);

    // Generate buffer
    const pptxBuffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer;

    const key = buildS3Key(organizationId, projectId, opportunityId, proposalId, proposal.document.title, 'pptx');

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

    return apiResponse(200, {
      success: true,
      proposal: { id: proposal.id, title: proposal.document.title },
      export: {
        format: 'pptx',
        bucket: DOCUMENTS_BUCKET,
        key,
        url,
        expiresIn: PRESIGN_EXPIRES_IN,
        contentType: CONTENT_TYPES.pptx,
        fileName: `${sanitizeFileName(proposal.document.title)}.pptx`,
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
    .use(httpErrorMiddleware()),
);