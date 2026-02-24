import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { apiResponse, getUserId } from '@/helpers/api';
import { getDocument } from './get-document';
import { withSentryLambda } from '@/sentry-lambda';
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

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const URL_EXPIRATION_SECONDS = Number(process.env.PRESIGN_EXPIRES_IN || 900);

const s3Client = new S3Client({ region: REGION });

/**
 * Download a document with ownership verification.
 * Only the user who uploaded the document (createdBy) can download it.
 *
 * GET /document/download?id={documentId}&kbId={kbId}
 */
export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const documentId = event.queryStringParameters?.id;
    const kbId = event.queryStringParameters?.kbId;

    if (!documentId || !kbId) {
      return apiResponse(400, {
        message: 'Missing required query parameters: id, kbId',
      });
    }

    const userId = getUserId(event);
    if (!userId) {
      return apiResponse(401, { message: 'Authentication required' });
    }

    // Fetch the document to check ownership
    const document = await getDocument(kbId, documentId);

    if (!document) {
      return apiResponse(404, { message: 'Document not found' });
    }

    // Ownership check: only the uploader can download
    if (document.createdBy && document.createdBy !== userId) {
      return apiResponse(403, {
        message: 'Access denied. You can only download documents you uploaded.',
      });
    }

    // Verify the document has a file key
    if (!document.fileKey) {
      return apiResponse(404, { message: 'Document has no associated file' });
    }

    // Generate presigned download URL
    const getObjectCmd = new GetObjectCommand({
      Bucket: DOCUMENTS_BUCKET,
      Key: document.fileKey,
    });

    const url = await getSignedUrl(s3Client as any, getObjectCmd, {
      expiresIn: URL_EXPIRATION_SECONDS,
    });

    
    setAuditContext(event, {
      action: 'DOCUMENT_VIEWED',
      resource: 'document',
      resourceId: event.pathParameters?.id ?? event.queryStringParameters?.id ?? 'unknown',
    });

    return apiResponse(200, {
      url,
      method: 'GET',
      fileName: document.name,
      expiresIn: URL_EXPIRATION_SECONDS,
    });
  } catch (err) {
    console.error('Error in download-document handler:', err);
    return apiResponse(500, {
      message: 'Failed to generate download URL',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:read'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
