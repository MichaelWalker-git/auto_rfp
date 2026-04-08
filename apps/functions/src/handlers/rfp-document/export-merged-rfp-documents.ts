import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { withSentryLambda } from '@/sentry-lambda';
import { getRFPDocument } from '@/helpers/rfp-document';
import { apiResponse, getOrgId } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';
import {
  loadDocumentHtmlForExport,
  expandTableOfContents,
  sanitizeFileName,
} from '@/helpers/export';
import { htmlToDocxBuffer } from '@/helpers/export-docx';
import { htmlToPdfBuffer } from '@/helpers/export-pdf';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const PRESIGN_EXPIRES_IN = Number(process.env.PRESIGN_EXPIRES_IN || 3600);

const s3Client = new S3Client({ region: REGION });

const RequestSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  documentIds: z.array(z.string().min(1)).min(1),
  format: z.enum(['docx', 'pdf']),
  options: z.object({
    pageSize: z.enum(['letter', 'a4']).default('letter'),
    pageBreakBetween: z.boolean().default(true),
  }).optional(),
});

const preprocessHtml = (rawHtml: string): string =>
  rawHtml
    .replace(/<p><br\s*\/?><\/p>/gi, '<p>&nbsp;</p>')
    .replace(/<p>\s*<\/p>/gi, '<p>&nbsp;</p>')
    .replace(/(<h[1-6][^>]*style="[^"]*?)border-bottom:[^;"]*;?\s*/gi, '$1')
    .replace(/(<h[1-6][^>]*style="[^"]*?)padding-bottom:[^;"]*;?\s*/gi, '$1');

const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    if (!event.body) return apiResponse(400, { message: 'Request body is required' });

    const raw = JSON.parse(event.body);
    const { success, data, error } = RequestSchema.safeParse(raw);
    if (!success) return apiResponse(400, { message: 'Validation error', issues: error.issues });

    const orgId = getOrgId(event) || 'DEFAULT';
    const pageSize = data.options?.pageSize ?? 'letter';
    const pageBreakBetween = data.options?.pageBreakBetween ?? true;

    // Load each document's HTML in order
    const htmlParts: string[] = [];
    const titles: string[] = [];

    for (const documentId of data.documentIds) {
      const doc = await getRFPDocument(data.projectId, data.opportunityId, documentId);
      if (!doc) {
        console.warn(`[export-merged] Document not found: ${documentId}, skipping`);
        continue;
      }
      if (doc.orgId !== orgId) continue;

      const title =
        doc.title ||
        (doc.content as Record<string, unknown>)?.title as string | undefined ||
        doc.name ||
        'Document';

      let html: string;
      try {
        html = await loadDocumentHtmlForExport(doc as Record<string, unknown>);
      } catch (err) {
        console.warn(`[export-merged] Failed to load HTML for ${documentId}:`, (err as Error)?.message);
        continue;
      }

      if (!html?.trim()) continue;

      titles.push(title);
      htmlParts.push(preprocessHtml(html));
    }

    if (htmlParts.length === 0) {
      return apiResponse(400, { message: 'No documents with exportable content found.' });
    }

    // Merge HTML: concatenate with page breaks
    const separator = pageBreakBetween
      ? '<div data-page-break="true"></div>'
      : '';

    const mergedHtml = htmlParts.join(separator);
    const withToc = expandTableOfContents(mergedHtml);

    // Convert to requested format
    const mergedTitle = titles.length <= 3
      ? titles.join(' + ')
      : `${titles[0]} + ${titles.length - 1} more`;

    let buffer: Buffer;
    if (data.format === 'docx') {
      buffer = await htmlToDocxBuffer(withToc, { title: mergedTitle, pageSize });
    } else {
      buffer = await htmlToPdfBuffer(withToc, { title: mergedTitle, pageSize });
    }

    // Upload to S3
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${sanitizeFileName(mergedTitle)}-merged-${timestamp}.${data.format}`;
    const s3Key = `${orgId}/${data.projectId}/${data.opportunityId}/rfp-documents/exports/${fileName}`;

    await s3Client.send(new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: s3Key,
      Body: buffer,
      ContentType: data.format === 'docx'
        ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        : 'application/pdf',
      ContentDisposition: `attachment; filename="${fileName}"`,
    }));

    const url = await getSignedUrl(
      s3Client,
      new PutObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: s3Key }),
      { expiresIn: PRESIGN_EXPIRES_IN },
    );

    // Use GET presigned URL for download
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const downloadUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: s3Key }),
      { expiresIn: PRESIGN_EXPIRES_IN },
    );

    return apiResponse(200, {
      success: true,
      fileName,
      url: downloadUrl,
      documentCount: htmlParts.length,
      format: data.format,
    });
  } catch (err) {
    console.error('Error in export-merged:', err);
    return apiResponse(500, {
      error: 'Internal server error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:create'))
    .use(httpErrorMiddleware()),
);
