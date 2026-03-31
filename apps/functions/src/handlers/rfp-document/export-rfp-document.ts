import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, requirePermission, type AuthedEvent } from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { withSentryLambda } from '@/sentry-lambda';
import { getRFPDocument } from '@/helpers/rfp-document';
import { apiResponse, getOrgId } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';
import {
  type ExportFormat,
  CONTENT_TYPES,
  FILE_EXTENSIONS,
  sanitizeFileName,
  loadDocumentHtmlForExport,
  expandTableOfContents,
} from '@/helpers/export';
import { buildExportHtml } from '@/helpers/export-html-builder';
import { htmlToPdfBuffer } from '@/helpers/export-pdf';
import { htmlToDocxBuffer } from '@/helpers/export-docx';
import { htmlToPptxBuffer } from '@/helpers/export-pptx';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const PRESIGN_EXPIRES_IN = Number(process.env.PRESIGN_EXPIRES_IN || 3600);

const s3Client = new S3Client({ region: REGION });

interface ExportRFPDocumentRequest {
  projectId: string;
  opportunityId: string;
  documentId: string;
  format: ExportFormat;
  options?: {
    pageSize?: 'letter' | 'a4';
    includeTableOfContents?: boolean;
    includeCitations?: boolean;
    pageLimitsPerSection?: number;
  };
}

const buildExportS3Key = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
  title: string,
  format: ExportFormat,
): string => {
  const sanitized = sanitizeFileName(title);
  const ext = FILE_EXTENSIONS[format] || `.${format}`;
  return `${orgId}/${projectId}/${opportunityId}/rfp-documents/${documentId}/exports/${sanitized}${ext}`;
};

const uploadAndPresign = async (
  body: Buffer | string,
  key: string,
  contentType: string,
): Promise<string> => {
  const buffer = typeof body === 'string' ? Buffer.from(body, 'utf-8') : body;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );

  return getSignedUrl(
    s3Client as Parameters<typeof getSignedUrl>[0],
    new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: key }),
    { expiresIn: PRESIGN_EXPIRES_IN },
  );
};

/**
 * Strip HTML tags for plain text export.
 */
const htmlToPlainText = (rawHtml: string): string =>
  rawHtml
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/**
 * Convert HTML to Markdown.
 */
const htmlToMarkdown = (rawHtml: string): string =>
  rawHtml
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n')
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n')
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, '*$1*')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is required' });
    }

    const body: ExportRFPDocumentRequest = JSON.parse(event.body);
    const { projectId, opportunityId, documentId, format, options: exportOptions } = body;

    if (!projectId || !opportunityId || !documentId || !format) {
      return apiResponse(400, {
        message: 'projectId, opportunityId, documentId, and format are required',
      });
    }

    const validFormats: ExportFormat[] = ['pdf', 'docx', 'pptx', 'html', 'txt', 'md'];
    if (!validFormats.includes(format)) {
      return apiResponse(400, {
        message: `Unsupported export format: ${format}. Supported: ${validFormats.join(', ')}`,
      });
    }

    const orgId = getOrgId(event) || 'DEFAULT';

    // Retrieve the RFP document
    const doc = await getRFPDocument(projectId, opportunityId, documentId);
    if (!doc || doc.deletedAt) {
      return apiResponse(404, { message: 'Document not found' });
    }

    // Require either htmlContentKey or structured content
    if (!doc.htmlContentKey && !doc.content) {
      return apiResponse(400, {
        message: 'This document does not have content for export.',
      });
    }

    const title = doc.title
      || (doc.content as Record<string, unknown>)?.title as string | undefined
      || doc.name
      || 'document';
    const pageSize = exportOptions?.pageSize ?? 'letter';
    const contentType = CONTENT_TYPES[format] || 'application/octet-stream';
    const s3Key = buildExportS3Key(orgId, projectId, opportunityId, documentId, title, format);

    // Load HTML from S3 with S3 image keys resolved to presigned URLs
    let resolvedHtml: string;
    try {
      resolvedHtml = await loadDocumentHtmlForExport(doc as Record<string, unknown>);
    } catch (err) {
      console.error('Failed to load document HTML for export:', err);
      return apiResponse(500, {
        message: 'Failed to load document content for export. Please try again.',
        error: err instanceof Error ? err.message : 'Unknown error',
      });
    }

    const rawHtml = resolvedHtml || '';

    if (!rawHtml) {
      return apiResponse(400, {
        message: 'This document does not have content for export. Please ensure the document has been saved with content.',
      });
    }

    // Preprocess: preserve empty paragraphs (TipTap blank lines).
    // TipTap outputs <p></p> or <p><br></p> for blank lines — replace with
    // non-breaking space so they occupy a full line height in all exports.
    // Also strip inline border-bottom styles from headings (legacy content
    // may have these baked in from older AI prompts/templates).
    const preprocessedHtml = rawHtml
      .replace(/<p><br\s*\/?><\/p>/gi, '<p>&nbsp;</p>')
      .replace(/<p>\s*<\/p>/gi, '<p>&nbsp;</p>')
      .replace(/(<h[1-6][^>]*style="[^"]*?)border-bottom:[^;"]*;?\s*/gi, '$1')
      .replace(/(<h[1-6][^>]*style="[^"]*?)padding-bottom:[^;"]*;?\s*/gi, '$1');

    // Expand Table of Contents placeholders into rendered TOC HTML.
    // This is used for PDF/HTML exports where we need a visual TOC with
    // page numbers and dot leaders. DOCX uses native Word TOC instead.
    const html = expandTableOfContents(preprocessedHtml);

    let exportBuffer: Buffer | string;

    switch (format) {
      // ── PDF: Headless Chromium renders the styled HTML to PDF ──
      case 'pdf': {
        exportBuffer = await htmlToPdfBuffer(html, { title, pageSize });
        break;
      }

      // ── DOCX: native docx library converts HTML to proper Word OOXML ──
      // Pass the preprocessed HTML WITHOUT TOC expansion — the DOCX exporter
      // detects the TOC placeholder and creates a native Word TOC field instead.
      case 'docx': {
        exportBuffer = await htmlToDocxBuffer(preprocessedHtml, { title, pageSize });
        break;
      }

      // ── PPTX: PptxGenJS generates a branded PowerPoint presentation ──
      case 'pptx': {
        const contentObj = doc.content as Record<string, unknown> | null;
        exportBuffer = await htmlToPptxBuffer(html, {
          title,
          customerName: contentObj?.customerName as string | null ?? null,
          opportunityId: contentObj?.opportunityId as string | null ?? null,
          outlineSummary: contentObj?.outlineSummary as string | null ?? null,
        });
        break;
      }

      // ── HTML: Wrap in styled HTML document ──
      case 'html': {
        exportBuffer = buildExportHtml(html, { title, pageSize });
        break;
      }

      // ── TXT: Strip HTML tags (use preprocessed HTML without TOC expansion) ──
      case 'txt': {
        exportBuffer = htmlToPlainText(preprocessedHtml);
        break;
      }

      // ── MD: Convert HTML to Markdown (use preprocessed HTML without TOC expansion) ──
      case 'md': {
        exportBuffer = htmlToMarkdown(preprocessedHtml);
        break;
      }

      default:
        return apiResponse(400, { message: `Unsupported format: ${format}` });
    }

    const url = await uploadAndPresign(exportBuffer, s3Key, contentType);

    setAuditContext(event, {
      action: 'DOCUMENT_EXPORTED',
      resource: 'document',
      resourceId: documentId,
    });

    return apiResponse(200, {
      success: true,
      document: {
        id: doc.documentId,
        title,
        documentType: doc.documentType,
      },
      export: {
        format,
        bucket: DOCUMENTS_BUCKET,
        key: s3Key,
        url,
        expiresIn: PRESIGN_EXPIRES_IN,
        contentType,
        fileName: `${sanitizeFileName(title)}${FILE_EXTENSIONS[format] || ''}`,
      },
    });
  } catch (err) {
    console.error('Error exporting RFP document:', err);
    return apiResponse(500, {
      message: 'Failed to export document',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
