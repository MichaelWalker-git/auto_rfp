import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { v4 as uuidv4 } from 'uuid';
import {
  saveVersionHtml,
  createVersion,
  getLatestVersionNumber,
} from '@/helpers/rfp-document-version';
import { getRFPDocument, updateRFPDocumentMetadata, uploadRFPDocumentHtml } from '@/helpers/rfp-document';
import { CherryPickDTOSchema } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const userId = getUserId(event);
  if (!userId) return apiResponse(401, { message: 'User not authenticated' });
  const userName = event.auth?.claims?.name || event.auth?.claims?.email || 'Unknown';

  if (!event.body) return apiResponse(400, { message: 'Request body is required' });

  const { success, data, error } = CherryPickDTOSchema.safeParse(JSON.parse(event.body));
  if (!success) {
    return apiResponse(400, { message: 'Invalid request', issues: error.issues });
  }

  // Verify document exists and belongs to org
  const doc = await getRFPDocument(data.projectId, data.opportunityId, data.documentId);
  if (!doc || doc.deletedAt) return apiResponse(404, { message: 'Document not found' });
  if (doc.orgId !== orgId) return apiResponse(403, { message: 'Access denied' });

  // Create new version number
  const latestVersionNum = await getLatestVersionNumber(
    data.projectId,
    data.opportunityId,
    data.documentId,
  );
  const newVersionNumber = latestVersionNum + 1;

  // Save the merged HTML (cherry-picked result computed client-side) to new version location
  const newHtmlKey = await saveVersionHtml(
    orgId,
    data.projectId,
    data.opportunityId,
    data.documentId,
    newVersionNumber,
    data.mergedHtml,
  );

  // Create version record
  const newVersion = await createVersion({
    versionId: uuidv4(),
    documentId: data.documentId,
    projectId: data.projectId,
    opportunityId: data.opportunityId,
    orgId,
    versionNumber: newVersionNumber,
    htmlContentKey: newHtmlKey,
    title: doc.title,
    documentType: doc.documentType,
    changeNote: data.changeNote || `Cherry-picked changes from version ${data.sourceVersion}`,
    createdBy: userId,
    createdByName: userName,
  });

  // Update the main document with the merged HTML
  await uploadRFPDocumentHtml({
    orgId,
    projectId: data.projectId,
    opportunityId: data.opportunityId,
    documentId: data.documentId,
    html: data.mergedHtml,
  });

  await updateRFPDocumentMetadata({
    projectId: data.projectId,
    opportunityId: data.opportunityId,
    documentId: data.documentId,
    updates: {
      editHistory: [
        ...(doc.editHistory || []),
        {
          editedBy: userId,
          editedByName: userName,
          editedAt: new Date().toISOString(),
          action: 'CONTENT_EDIT',
          changeNote: data.changeNote || `Cherry-picked from v${data.sourceVersion}`,
          version: newVersionNumber,
        },
      ],
    },
    updatedBy: userId,
  });

  // Audit log (non-blocking)
  writeAuditLog(
    {
      logId: uuidv4(),
      timestamp: nowIso(),
      userId,
      userName,
      organizationId: orgId,
      action: 'DOCUMENT_VERSION_CHERRYPICKED',
      resource: 'document_version',
      resourceId: newVersion.versionId,
      changes: {
        before: { sourceVersion: data.sourceVersion },
        after: {
          versionNumber: newVersionNumber,
          documentId: data.documentId,
          cherryPickedFromVersion: data.sourceVersion,
        },
      },
      ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent: event.headers?.['user-agent'] ?? 'system',
      result: 'success',
    },
    await getHmacSecret(),
  ).catch((err) => console.warn('Failed to write audit log (non-blocking):', err.message));

  return apiResponse(200, { ok: true, version: newVersion });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:edit'))
    .use(httpErrorMiddleware()),
);
