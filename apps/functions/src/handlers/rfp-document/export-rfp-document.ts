import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
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
} from '@/helpers/export';

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

function buildExportS3Key(
  orgId: string,
  projectId: string,
  opportunityId: string,
  documentId: string,
  title: string,
  format: ExportFormat,
): string {
  const sanitized = sanitizeFileName(title);
  const ext = FILE_EXTENSIONS[format] || `.${format}`;
  return `${orgId}/${projectId}/${opportunityId}/rfp-documents/${documentId}/exports/${sanitized}${ext}`;
}

async function uploadAndPresign(
  buffer: Buffer | string,
  key: string,
  contentType: string,
): Promise<string> {
  const body = typeof buffer === 'string' ? Buffer.from(buffer, 'utf-8') : buffer;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );

  const url = await getSignedUrl(
    s3Client as any,
    new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: key }),
    { expiresIn: PRESIGN_EXPIRES_IN },
  );

  return url;
}

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is required' });
    }

    const body: ExportRFPDocumentRequest = JSON.parse(event.body);
    const { projectId, opportunityId, documentId, format } = body;

    if (!projectId || !opportunityId || !documentId || !format) {
      return apiResponse(400, {
        message: 'projectId, opportunityId, documentId, and format are required',
      });
    }

    // DOCX is generated client-side — only text-based formats are supported here
    const validFormats: ExportFormat[] = ['html', 'txt', 'md'];
    if (!validFormats.includes(format)) {
      return apiResponse(400, {
        message: `Unsupported export format: ${format}. Supported: ${validFormats.join(', ')}. DOCX is generated client-side.`,
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

    const title = doc.title || (doc.content as Record<string, unknown>)?.title as string | undefined || doc.name || 'document';
    const contentType = CONTENT_TYPES[format] || 'application/octet-stream';
    const s3Key = buildExportS3Key(orgId, projectId, opportunityId, documentId, title, format);

    // ── Text-based exports (html, md, txt) — use raw HTML from S3 ──
    // Load HTML from S3 with S3 image keys resolved to presigned URLs
    const resolvedHtml = await loadDocumentHtmlForExport(doc as Record<string, unknown>);

    if (!resolvedHtml && !doc.content) {
      return apiResponse(400, {
        message: 'This document does not have content for export.',
      });
    }

    // For HTML: wrap the raw editor HTML in a minimal page shell
    // For MD/TXT: strip HTML tags from the raw content
    const rawHtml = resolvedHtml || (doc.content as Record<string, unknown>)?.content as string || '';

    let exportContent: string;

    switch (format) {
      case 'html':
        // Wrap in a minimal HTML page so it opens correctly in browsers
        exportContent = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body>${rawHtml}</body></html>`;
        break;
      case 'md':
        // Convert HTML to Markdown by stripping tags and converting headings
        exportContent = rawHtml
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
        break;
      case 'txt':
        // Strip all HTML tags for plain text
        exportContent = rawHtml
          .replace(/<br\s*\/?>/gi, '\n')
          .replace(/<\/p>/gi, '\n\n')
          .replace(/<\/h[1-6]>/gi, '\n\n')
          .replace(/<\/li>/gi, '\n')
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        break;
      default:
        return apiResponse(400, { message: `Unsupported format: ${format}` });
    }

    const url = await uploadAndPresign(exportContent, s3Key, contentType);

    
    setAuditContext(event, {
      action: 'PROPOSAL_EXPORTED',
      resource: 'proposal',
      resourceId: event.pathParameters?.documentId ?? event.queryStringParameters?.documentId ?? 'unknown',
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

export const handler = withSentryLambda(middy(baseHandler));