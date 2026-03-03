import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

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
import {
  buildS3Key,
  CONTENT_TYPES,
  type ExportRequest,
  proposalToHtml,
  sanitizeFileName,
  loadDocumentHtmlForExport,
} from '@/helpers/export';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const PRESIGN_EXPIRES_IN = Number(process.env.PRESIGN_EXPIRES_IN || 3600);

const s3Client = new S3Client({ region: REGION });

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
    if (!rfpDoc.content) {
      return apiResponse(400, { message: 'Document has no structured content' });
    }
    const proposal = { id: rfpDoc.documentId, organizationId: rfpDoc.orgId, document: rfpDoc.content as any };

    const organizationId = proposal.organizationId || getOrgId(event) || 'DEFAULT';

    // Load HTML from S3 (or inline fallback) with S3 image keys resolved to presigned URLs
    const resolvedHtml = await loadDocumentHtmlForExport(rfpDoc as Record<string, unknown>);
    const docWithHtml = { ...proposal.document, content: resolvedHtml };
    const htmlContent = proposalToHtml(docWithHtml);
    const htmlBuffer = Buffer.from(htmlContent, 'utf-8');

    const key = buildS3Key(organizationId, projectId, opportunityId, proposalId, proposal.document.title, 'html');

    await s3Client.send(new PutObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: key,
      Body: htmlBuffer,
      ContentType: CONTENT_TYPES.html,
    }));

    const url = await getSignedUrl(s3Client as any, new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: key,
    }), { expiresIn: PRESIGN_EXPIRES_IN });

    
    setAuditContext(event, {
      action: 'DATA_EXPORTED',
      resource: 'proposal',
      resourceId: event.queryStringParameters?.projectId ?? 'unknown',
    });

    return apiResponse(200, {
      success: true,
      proposal: { id: proposal.id, title: proposal.document.title },
      export: {
        format: 'html',
        bucket: DOCUMENTS_BUCKET,
        key,
        url,
        expiresIn: PRESIGN_EXPIRES_IN,
        contentType: CONTENT_TYPES.html,
        fileName: `${sanitizeFileName(proposal.document.title)}.html`,
      },
    });
  } catch (err) {
    console.error('Error generating HTML:', err);
    return apiResponse(500, {
      message: 'Failed to generate HTML',
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