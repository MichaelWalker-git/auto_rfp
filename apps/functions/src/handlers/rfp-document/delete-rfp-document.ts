import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { withSentryLambda } from '@/sentry-lambda';
import { getRFPDocument, softDeleteRFPDocument } from '@/helpers/rfp-document';
import { deleteS3ObjectsFromKeys } from '@/helpers/s3';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });
    const userId = getUserId(event);
    if (!userId) return apiResponse(401, { message: 'User not authenticated' });

    const body = event.body ? JSON.parse(event.body) : {};
    const projectId = body.projectId || event.queryStringParameters?.projectId;
    const opportunityId = body.opportunityId || event.queryStringParameters?.opportunityId;
    const documentId = body.documentId || event.queryStringParameters?.documentId;

    if (!projectId || !opportunityId || !documentId) {
      return apiResponse(400, { message: 'projectId, opportunityId, and documentId are required' });
    }

    const existing = await getRFPDocument(projectId, opportunityId, documentId);
    if (!existing || existing.deletedAt) {
      return apiResponse(404, { message: 'Document not found' });
    }
    if (existing.orgId !== orgId) {
      return apiResponse(403, { message: 'Access denied' });
    }

    // ── Soft-delete the DynamoDB record ──
    await softDeleteRFPDocument({ projectId, opportunityId, documentId, deletedBy: userId });

    // ── Clean up all S3 objects associated with this document (best-effort) ──
    const s3KeysToDelete: unknown[] = [
      existing.fileKey,        // original uploaded file
      existing.htmlContentKey, // generated/converted HTML content
    ];

    const { deleted, failed, skipped } = await deleteS3ObjectsFromKeys(DOCUMENTS_BUCKET, s3KeysToDelete);
    if (failed > 0) {
      console.warn(`S3 cleanup: deleted=${deleted}, failed=${failed}, skipped=${skipped} for documentId=${documentId}`);
    } else {
      console.log(`S3 cleanup: deleted=${deleted}, skipped=${skipped} for documentId=${documentId}`);
    }

    setAuditContext(event, {
      action: 'DATA_EXPORTED',
      resource: 'proposal',
      resourceId: documentId,
    });

    return apiResponse(200, { ok: true, message: 'Document deleted' });
  } catch (err) {
    console.error('Error in delete-rfp-document:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:delete'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
