import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { withSentryLambda } from '@/sentry-lambda';
import { getRFPDocument } from '@/helpers/rfp-document';
import { apiResponse, getOrgId } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';
import { type RFPDocumentContent, RFPDocumentContentSchema } from '@auto-rfp/core';
import {
  type ExportFormat,
  CONTENT_TYPES,
  FILE_EXTENSIONS,
  sanitizeFileName,
  flattenProposalToText,
  proposalToMarkdown,
  proposalToHtml,
} from '@/handlers/export/export-utils';

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
  event: APIGatewayProxyEventV2,
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

    const validFormats: ExportFormat[] = ['html', 'txt', 'md'];
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

    // Validate that the document has structured content (proposal-type)
    if (!doc.content) {
      return apiResponse(400, {
        message: 'This document does not have structured content for export. Only content-based documents (e.g., PROPOSAL) can be exported.',
      });
    }

    const contentParsed = RFPDocumentContentSchema.safeParse(doc.content);
    if (!contentParsed.success) {
      return apiResponse(400, {
        message: 'Document content is not a valid proposal document structure',
        issues: contentParsed.error.format(),
      });
    }

    const proposalDoc: RFPDocumentContent = contentParsed.data;
    const title = doc.title || proposalDoc.title || doc.name || 'document';

    let exportContent: string;
    const contentType = CONTENT_TYPES[format] || 'application/octet-stream';

    switch (format) {
      case 'html':
        exportContent = proposalToHtml(proposalDoc);
        break;
      case 'md':
        exportContent = proposalToMarkdown(proposalDoc);
        break;
      case 'txt':
        exportContent = flattenProposalToText(proposalDoc);
        break;
      default:
        return apiResponse(400, { message: `Unsupported format: ${format}` });
    }

    const s3Key = buildExportS3Key(orgId, projectId, opportunityId, documentId, title, format);
    const url = await uploadAndPresign(exportContent, s3Key, contentType);

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