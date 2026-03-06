import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { withSentryLambda } from '@/sentry-lambda';
import { getRFPDocument, updateRFPDocumentWithContent } from '@/helpers/rfp-document';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';
import { UpdateRFPDocumentDTOSchema } from '@auto-rfp/core';

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
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'OrgId is missing' });
    const userId = getUserId(event);
    if (!userId) return apiResponse(401, { message: 'User not authenticated' });
    const userName = event.auth?.claims?.name || event.auth?.claims?.email || 'Unknown';

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

    // Update document (business logic in helper)
    const updated = await updateRFPDocumentWithContent({
      orgId,
      projectId: dto.projectId,
      opportunityId: dto.opportunityId,
      documentId: dto.documentId,
      dto,
      userId,
    });

    // Write audit log
    writeAuditLog(
      {
        logId: uuidv4(),
        timestamp: nowIso(),
        userId,
        userName,
        organizationId: orgId,
        action: 'DOCUMENT_UPDATED',
        resource: 'rfp_document',
        resourceId: dto.documentId,
        changes: {
          before: { title: existing.title },
          after: { title: dto.content?.title ?? existing.title },
        },
        ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
        userAgent: event.headers?.['user-agent'] ?? 'unknown',
        result: 'success',
      },
      await getHmacSecret(),
    ).catch((err) => console.warn('Non-blocking audit log failed:', err));

    return apiResponse(200, { ok: true, document: updated });
  } catch (err) {
    console.error('Error updating RFP document:', err);
    return apiResponse(500, { message: 'Internal server error' });
  }
};


export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(httpErrorMiddleware()),
);
