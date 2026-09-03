/**
 * sync-to-google-drive.ts
 *
 * Pushes an RFP document's current content to Google Drive as a **native Google
 * Doc**, so the team can edit it collaboratively in Drive.
 *
 * First sync creates the file; every sync after that updates the same file in
 * place, so re-syncing does not litter the folder with duplicates. All logic lives
 * in `@/helpers/google-drive-document-sync`; this handler only parses, delegates,
 * and formats the response.
 */

import { z } from 'zod';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { apiResponse, getOrgId } from '@/helpers/api';
import {
  DRIVE_NOT_CONFIGURED_DETAILS,
  getDriveClientForOrg,
} from '@/helpers/google-drive-client';
import {
  claimDriveSync,
  loadDriveSyncDocument,
  markDriveSyncFailed,
  pushDocumentToDrive,
} from '@/helpers/google-drive-document-sync';

const SyncRequestSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  documentId: z.string().min(1),
});

export const baseHandler = async (event: AuthedEvent) => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(400, { message: 'orgId is required' });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(event.body || '{}');
  } catch {
    return apiResponse(400, { error: 'Invalid request', details: 'Body is not valid JSON' });
  }

  const { success, data, error } = SyncRequestSchema.safeParse(raw);
  if (!success) {
    return apiResponse(400, { error: 'Invalid request', details: error.flatten() });
  }

  const { projectId, opportunityId, documentId } = data;

  try {
    const doc = await loadDriveSyncDocument({ projectId, opportunityId, documentId });
    if (!doc) {
      return apiResponse(404, { error: 'Document not found' });
    }

    const client = await getDriveClientForOrg(orgId);
    if (!client) {
      return apiResponse(400, {
        code: 'DRIVE_NOT_CONFIGURED',
        error: 'Google Drive not configured for this organization.',
        details: DRIVE_NOT_CONFIGURED_DETAILS,
      });
    }

    const claimed = await claimDriveSync({ projectId, opportunityId, documentId });
    if (!claimed) {
      return apiResponse(409, {
        code: 'DRIVE_SYNC_IN_PROGRESS',
        error: 'A Google Drive sync is already running for this document.',
      });
    }

    try {
      const result = await pushDocumentToDrive({
        drive: client.drive,
        doc,
        orgId,
        projectId,
        opportunityId,
        documentId,
        updatedBy: event.auth?.userId ?? 'system',
      });

      setAuditContext(event, {
        action: 'INTEGRATION_SYNC_COMPLETED',
        resource: 'document',
        resourceId: documentId,
      });

      return apiResponse(200, {
        message: result.updatedExisting
          ? 'Google Doc updated'
          : 'Document synced to Google Drive',
        documentId,
        ...result,
        syncStatus: 'SYNCED',
      });
    } catch (err) {
      // Release the claim and surface the reason, so the badge isn't stuck on SYNCING.
      await markDriveSyncFailed({
        projectId,
        opportunityId,
        documentId,
        message: (err as Error)?.message ?? 'Unknown error',
      }).catch((markErr) => {
        console.error('[GoogleDrive] Failed to record sync failure:', markErr);
      });
      throw err;
    }
  } catch (err) {
    console.error('Error syncing RFP document to Google Drive:', err);
    return apiResponse(500, { message: 'Failed to sync document to Google Drive' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
