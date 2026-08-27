/**
 * sync-from-google-drive.ts
 *
 * Imports the linked Google Doc's current content back into AutoRFP — the "Sync
 * now" half of the bidirectional link, and the same code path the 15-minute poller
 * runs. All logic lives in `@/helpers/google-drive-document-sync`; this handler
 * only parses, delegates, and formats the response.
 *
 * Two things worth knowing before changing this:
 *  - Every import creates a version snapshot, so a bad Drive edit stays recoverable.
 *  - An approved document is **blocked**, not overwritten. `acceptApprovedOverride`
 *    is the deliberate escape hatch and it reopens the approval, so it is exposed
 *    only here on the manual path — the poller must never make that call for a user.
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
  loadDriveSyncDocument,
  markDriveSyncFailed,
  pullDocumentFromDriveIfChanged,
} from '@/helpers/google-drive-document-sync';

const SyncFromRequestSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  documentId: z.string().min(1),
  /** Import into an approved document anyway, reopening its approval. */
  acceptApprovedOverride: z.boolean().optional().default(false),
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

  const { success, data, error } = SyncFromRequestSchema.safeParse(raw);
  if (!success) {
    return apiResponse(400, { error: 'Invalid request', details: error.flatten() });
  }

  const { projectId, opportunityId, documentId, acceptApprovedOverride } = data;

  try {
    const doc = await loadDriveSyncDocument({ projectId, opportunityId, documentId });
    if (!doc) {
      return apiResponse(404, { error: 'Document not found' });
    }

    if (!doc.googleDriveFileId) {
      return apiResponse(400, {
        code: 'DRIVE_NOT_LINKED',
        error: 'Document has not been synced to Google Drive yet. Sync to Google Drive first.',
      });
    }

    const client = await getDriveClientForOrg(orgId);
    if (!client) {
      return apiResponse(400, {
        code: 'DRIVE_NOT_CONFIGURED',
        error: 'Google Drive not configured for this organization.',
        details: DRIVE_NOT_CONFIGURED_DETAILS,
      });
    }

    try {
      const result = await pullDocumentFromDriveIfChanged({
        drive: client.drive,
        doc,
        orgId,
        projectId,
        opportunityId,
        documentId,
        actorUserId: event.auth?.userId,
        actorName: event.auth?.claims?.['cognito:username'] as string | undefined,
        acceptApprovedOverride,
      });

      // The claim is taken inside the helper, so a lost race comes back as a result
      // rather than an exception.
      if (result.inProgress) {
        return apiResponse(409, {
          code: 'DRIVE_SYNC_IN_PROGRESS',
          error: 'A Google Drive sync is already running for this document.',
        });
      }

      if (result.blocked) {
        return apiResponse(409, {
          ...result,
          code: 'DRIVE_BLOCKED_APPROVED',
          error: result.reason,
          documentId,
          syncStatus: 'BLOCKED_APPROVED',
        });
      }

      setAuditContext(event, {
        action: 'INTEGRATION_SYNC_COMPLETED',
        resource: 'rfp_document',
        resourceId: documentId,
      });

      return apiResponse(200, {
        ...result,
        message: result.changed
          ? 'Document synced from Google Drive'
          : 'Already up to date with Google Drive',
        documentId,
        syncStatus: result.changed ? 'SYNCED' : (doc.driveSyncStatus ?? 'SYNCED'),
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
    console.error('Error syncing from Google Drive:', err);
    return apiResponse(500, { message: 'Failed to sync from Google Drive' });
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
