import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { v4 as uuidv4 } from 'uuid';
import {
  saveVersionHtml,
  createVersion,
  getLatestVersionNumber,
  getVersion,
  loadVersionHtml,
} from '@/helpers/rfp-document-version';
import { getRFPDocument, updateRFPDocumentMetadata, uploadRFPDocumentHtml } from '@/helpers/rfp-document';
import { RevertVersionDTOSchema } from '@auto-rfp/core';
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

  const { success, data, error } = RevertVersionDTOSchema.safeParse(JSON.parse(event.body));
  if (!success) {
    return apiResponse(400, { message: 'Invalid request', issues: error.issues });
  }

  // Verify document exists and belongs to org
  const doc = await getRFPDocument(data.projectId, data.opportunityId, data.documentId);
  if (!doc || doc.deletedAt) return apiResponse(404, { message: 'Document not found' });
  if (doc.orgId !== orgId) return apiResponse(403, { message: 'Access denied' });

  // Verify target version exists
  const targetVer = await getVersion(
    data.projectId,
    data.opportunityId,
    data.documentId,
    data.targetVersion,
  );
  if (!targetVer) {
    return apiResponse(404, { message: `Version ${data.targetVersion} not found` });
  }

  // Load the HTML content from the target version
  const targetHtml = await loadVersionHtml(targetVer.htmlContentKey);

  // Create new version number
  const latestVersionNum = await getLatestVersionNumber(
    data.projectId,
    data.opportunityId,
    data.documentId,
  );
  const newVersionNumber = latestVersionNum + 1;

  // Save the reverted HTML to new version location
  const newHtmlKey = await saveVersionHtml(
    orgId,
    data.projectId,
    data.opportunityId,
    data.documentId,
    newVersionNumber,
    targetHtml,
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
    title: doc.title || targetVer.title,
    documentType: doc.documentType,
    changeNote: data.changeNote || `Reverted to version ${data.targetVersion}`,
    createdBy: userId,
    createdByName: userName,
  });

  // Update the main document with the reverted HTML
  await uploadRFPDocumentHtml({
    orgId,
    projectId: data.projectId,
    opportunityId: data.opportunityId,
    documentId: data.documentId,
    html: targetHtml,
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
          changeNote: data.changeNote || `Reverted to v${data.targetVersion}`,
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
      action: 'DOCUMENT_VERSION_REVERTED',
      resource: 'document_version',
      resourceId: newVersion.versionId,
      changes: {
        before: { versionNumber: data.targetVersion },
        after: {
          versionNumber: newVersionNumber,
          documentId: data.documentId,
          revertedFromVersion: data.targetVersion,
        },
      },
      ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent: event.headers?.['user-agent'] ?? 'system',
      result: 'success',
    },
    await getHmacSecret(),
  ).catch((err) => console.warn('Failed to write audit log (non-blocking):', err.message));

  return apiResponse(200, { ok: true, version: newVersion, html: targetHtml });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('document:edit'))
    .use(httpErrorMiddleware()),
);
