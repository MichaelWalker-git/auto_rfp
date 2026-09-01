import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { UpdateRFPDocumentDTOSchema } from '@auto-rfp/core';
import { withSentryLambda } from '@/sentry-lambda';
import { getRFPDocument, updateRFPDocumentWithContent } from '@/helpers/rfp-document';
import { autoPushDocumentToDriveIfConfigured } from '@/helpers/google-drive-document-sync';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { authContextMiddleware, httpErrorMiddleware, orgMembershipMiddleware, requirePermission } from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

/**
 * PATCH /rfp-document/update
 *
 * Updates RFP document metadata and/or content.
 * If content.content (HTML) is provided, uploads it to S3 and stores only the key in DynamoDB.
 *
 * Query params: orgId (optional, extracted from auth context)
 * Body: UpdateRFPDocumentDTO
 */
export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });

  const userId = getUserId(event);
  if (!userId) return apiResponse(401, { message: 'User not authenticated' });

  if (!event.body) return apiResponse(400, { message: 'Request body is missing' });

  const rawBody = JSON.parse(event.body);
  const { success, data: dto, error } = UpdateRFPDocumentDTOSchema.safeParse(rawBody);

  if (!success) {
    return apiResponse(400, {
      message: 'Invalid request payload',
      issues: error.issues,
    });
  }

  // Verify document exists and user has access
  const existing = await getRFPDocument(dto.projectId, dto.opportunityId, dto.documentId);
  if (!existing || existing.deletedAt) {
    return apiResponse(404, { message: 'Document not found' });
  }
  if (existing.orgId !== orgId) {
    return apiResponse(403, { message: 'Access denied' });
  }

  const updated = await updateRFPDocumentWithContent({
    orgId,
    projectId: dto.projectId,
    opportunityId: dto.opportunityId,
    documentId: dto.documentId,
    dto,
    userId,
  });

  // Content changed — keep the linked Google Doc in step without a manual
  // re-sync. Only actual HTML saves trigger the push (metadata-only PATCHes do
  // not), and the helper is a no-op when Drive is not configured for the org.
  // It swallows its own errors so a Drive outage can never fail the save.
  if (typeof dto.content?.content === 'string' && dto.content.content) {
    await autoPushDocumentToDriveIfConfigured({
      orgId,
      projectId: dto.projectId,
      opportunityId: dto.opportunityId,
      documentId: dto.documentId,
      rePushExisting: true,
    });
  }

  setAuditContext(event, {
    action: 'DOCUMENT_UPLOADED',
    resource: 'document',
    resourceId: dto.documentId,
  });

  return apiResponse(200, { ok: true, document: updated });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
