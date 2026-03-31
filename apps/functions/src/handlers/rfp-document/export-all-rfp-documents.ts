import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import JSZip from 'jszip';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { withSentryLambda } from '@/sentry-lambda';
import { listRFPDocumentsByProject } from '@/helpers/rfp-document';
import { apiResponse, getOrgId } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';
import {
  type ExportFormat,
  FILE_EXTENSIONS,
  sanitizeFileName,
  loadDocumentHtmlForExport,
  expandTableOfContents,
} from '@/helpers/export';
import { htmlToPdfBuffer } from '@/helpers/export-pdf';
import { htmlToDocxBuffer } from '@/helpers/export-docx';
import { htmlToPptxBuffer } from '@/helpers/export-pptx';
import { buildExportHtml } from '@/helpers/export-html-builder';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const PRESIGN_EXPIRES_IN = Number(process.env.PRESIGN_EXPIRES_IN || 3600);

const s3Client = new S3Client({ region: REGION });

const VALID_FORMATS: ExportFormat[] = ['docx', 'pdf', 'pptx', 'html', 'txt', 'md'];

interface ExportAllRequest {
  projectId: string;
  opportunityId?: string;
  formats?: ExportFormat[];
  options?: {
    pageSize?: 'letter' | 'a4';
  };
}

interface ExportedDocInfo {
  documentId: string;
  title: string;
  formats: string[];
  skipped: boolean;
  skipReason?: string;
}

/**
 * Preprocess HTML for export — preserve empty paragraphs and strip legacy heading styles.
 */
const preprocessHtml = (rawHtml: string): string =>
  rawHtml
    .replace(/<p><br\s*\/?><\/p>/gi, '<p>&nbsp;</p>')
    .replace(/<p>\s*<\/p>/gi, '<p>&nbsp;</p>')
    .replace(/(<h[1-6][^>]*style="[^"]*?)border-bottom:[^;"]*;?\s*/gi, '$1')
    .replace(/(<h[1-6][^>]*style="[^"]*?)padding-bottom:[^;"]*;?\s*/gi, '$1');

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

/**
 * Export a single document to a specific format, returning the buffer.
 *
 * TOC handling per format:
 * - PDF/HTML: expandTableOfContents renders the TOC as styled HTML with page numbers
 * - DOCX: raw preprocessed HTML is passed — the DOCX exporter detects the TOC
 *   placeholder and builds native Word TOC paragraphs with dot leaders
 * - Other formats: TOC placeholder is stripped during HTML-to-text conversion
 */
const exportDocumentToFormat = async (
  html: string,
  title: string,
  format: ExportFormat,
  pageSize: 'letter' | 'a4',
  doc?: Record<string, unknown>,
): Promise<Buffer | null> => {
  try {
    const processed = preprocessHtml(html);
    // Expand TOC for formats that render HTML visually (PDF, HTML)
    const withToc = expandTableOfContents(processed);

    switch (format) {
      case 'pdf':
        return await htmlToPdfBuffer(withToc, { title, pageSize });
      case 'docx':
        // Pass preprocessed HTML WITHOUT TOC expansion — the DOCX exporter
        // detects the TOC placeholder and creates native Word TOC entries
        return await htmlToDocxBuffer(processed, { title, pageSize });
      case 'pptx': {
        const contentObj = doc?.content as Record<string, unknown> | null;
        return await htmlToPptxBuffer(withToc, {
          title,
          customerName: contentObj?.customerName as string | null ?? null,
          opportunityId: contentObj?.opportunityId as string | null ?? null,
          outlineSummary: contentObj?.outlineSummary as string | null ?? null,
        });
      }
      case 'html':
        return Buffer.from(buildExportHtml(withToc, { title, pageSize }), 'utf-8');
      case 'txt':
        return Buffer.from(htmlToPlainText(withToc), 'utf-8');
      case 'md':
        return Buffer.from(htmlToMarkdown(withToc), 'utf-8');
      default:
        return null;
    }
  } catch (err) {
    console.error(`Failed to export document "${title}" as ${format}:`, err);
    return null;
  }
};

const buildExportAllS3Key = (
  orgId: string,
  projectId: string,
  opportunityId: string | undefined,
): string => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const oppPart = opportunityId ? `/${opportunityId}` : '';
  return `${orgId}/${projectId}${oppPart}/rfp-documents/exports/all-documents-${timestamp}.zip`;
};

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) {
      return apiResponse(400, { message: 'Request body is required' });
    }

    const body: ExportAllRequest = JSON.parse(event.body);
    const { projectId, opportunityId, formats: requestedFormats, options: exportOptions } = body;

    if (!projectId) {
      return apiResponse(400, { message: 'projectId is required' });
    }

    const orgId = getOrgId(event) || 'DEFAULT';
    const pageSize = exportOptions?.pageSize ?? 'letter';

    // Validate and resolve formats — default to docx + pdf
    const selectedFormats: ExportFormat[] = requestedFormats?.length
      ? requestedFormats.filter((f) => VALID_FORMATS.includes(f))
      : ['docx', 'pdf'];

    if (selectedFormats.length === 0) {
      return apiResponse(400, {
        message: `No valid formats specified. Supported: ${VALID_FORMATS.join(', ')}`,
      });
    }

    // List all RFP documents for this project/opportunity
    const result = await listRFPDocumentsByProject({
      projectId,
      opportunityId: opportunityId || undefined,
      limit: 100, // reasonable upper bound
    });

    // Filter by orgId for security and exclude deleted/generating docs
    const documents = result.items.filter(
      (item) =>
        item.orgId === orgId &&
        !item.deletedAt &&
        item.status !== 'GENERATING',
    );

    if (documents.length === 0) {
      return apiResponse(400, {
        message: 'No documents available for export. Generate documents first.',
      });
    }

    // Filter to only content-based documents (those with htmlContentKey)
    const exportableDocs = documents.filter(
      (doc) => doc.htmlContentKey || doc.content,
    );

    if (exportableDocs.length === 0) {
      return apiResponse(400, {
        message: 'No documents with exportable content found. Documents must have generated content to be exported.',
      });
    }

    const zip = new JSZip();
    const exportedDocs: ExportedDocInfo[] = [];

    // Process each document
    for (const doc of exportableDocs) {
      const title =
        doc.title ||
        (doc.content as Record<string, unknown>)?.title as string | undefined ||
        doc.name ||
        'document';

      const sanitizedTitle = sanitizeFileName(title);

      // Load HTML content
      let resolvedHtml: string;
      try {
        resolvedHtml = await loadDocumentHtmlForExport(doc as Record<string, unknown>);
      } catch (err) {
        console.error(`Failed to load HTML for document "${title}" (${doc.documentId}):`, err);
        exportedDocs.push({
          documentId: doc.documentId,
          title,
          formats: [],
          skipped: true,
          skipReason: 'Failed to load document content',
        });
        continue;
      }

      if (!resolvedHtml || !resolvedHtml.trim()) {
        exportedDocs.push({
          documentId: doc.documentId,
          title,
          formats: [],
          skipped: true,
          skipReason: 'Document has no content (blank)',
        });
        continue;
      }

      const docFormats: string[] = [];

      // Export in each selected format
      for (const format of selectedFormats) {
        const buffer = await exportDocumentToFormat(
          resolvedHtml, title, format, pageSize, doc as Record<string, unknown>,
        );
        if (buffer) {
          const ext = FILE_EXTENSIONS[format] || `.${format}`;
          zip.file(`${sanitizedTitle}${ext}`, buffer);
          docFormats.push(format);
        }
      }

      exportedDocs.push({
        documentId: doc.documentId,
        title,
        formats: docFormats,
        skipped: docFormats.length === 0,
        skipReason: docFormats.length === 0 ? 'Export conversion failed' : undefined,
      });
    }

    // Check if any documents were actually exported
    const successfulExports = exportedDocs.filter((d) => !d.skipped);
    if (successfulExports.length === 0) {
      return apiResponse(500, {
        message: 'Failed to export any documents. Please try again.',
        documents: exportedDocs,
      });
    }

    // Generate the ZIP buffer
    const zipBuffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
      compressionOptions: { level: 6 },
    });

    // Upload ZIP to S3
    const s3Key = buildExportAllS3Key(orgId, projectId, opportunityId);
    await s3Client.send(
      new PutObjectCommand({
        Bucket: DOCUMENTS_BUCKET,
        Key: s3Key,
        Body: zipBuffer,
        ContentType: 'application/zip',
      }),
    );

    // Generate presigned URL
    const url = await getSignedUrl(
      s3Client as Parameters<typeof getSignedUrl>[0],
      new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: s3Key }),
      { expiresIn: PRESIGN_EXPIRES_IN },
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const zipFileName = `RFP-Documents-Export-${timestamp}.zip`;

    setAuditContext(event, {
      action: 'DOCUMENTS_BULK_EXPORTED',
      resource: 'rfp_document',
      resourceId: projectId,
    });

    return apiResponse(200, {
      success: true,
      export: {
        url,
        fileName: zipFileName,
        bucket: DOCUMENTS_BUCKET,
        key: s3Key,
        expiresIn: PRESIGN_EXPIRES_IN,
        contentType: 'application/zip',
        sizeBytes: zipBuffer.length,
      },
      summary: {
        totalDocuments: exportableDocs.length,
        exportedDocuments: successfulExports.length,
        skippedDocuments: exportedDocs.filter((d) => d.skipped).length,
        formats: selectedFormats,
      },
      documents: exportedDocs,
    });
  } catch (err) {
    console.error('Error in export-all-rfp-documents:', err);
    return apiResponse(500, {
      message: 'Failed to export documents',
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
