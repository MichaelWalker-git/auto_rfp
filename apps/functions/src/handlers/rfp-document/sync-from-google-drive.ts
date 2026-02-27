/**
 * sync-from-google-drive.ts
 *
 * Pulls the latest version of an RFP document from Google Drive back into the
 * application.  The document must have been previously synced TO Google Drive
 * (i.e. `googleDriveFileId` must be set on the DB record).
 *
 * Flow:
 *  1. Load the DB record and verify googleDriveFileId is present.
 *  2. Authenticate with Google Drive using domain-wide delegation.
 *  3. Download the file from Google Drive.
 *  4. If the file is a DOCX, convert it to HTML using mammoth and store the
 *     HTML in S3 (updating htmlContentKey).
 *  5. If the file is any other type, store it as a raw file in S3 (updating
 *     fileKey / mimeType).
 *  6. Update the DB record with the new keys and a lastSyncedAt timestamp.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { z } from 'zod';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { apiResponse, getOrgId } from '@/helpers/api';
import { getItem, updateItem } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { getApiKey } from '@/helpers/api-key-storage';
import { GOOGLE_SECRET_PREFIX } from '@/constants/google';
import { RFP_DOCUMENT_PK } from '@/constants/rfp-document';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { drive_v3, google } from 'googleapis';
import type { DBItem } from '@/helpers/db';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mammoth = require('mammoth') as { convertToHtml: (input: { buffer: Buffer }) => Promise<{ value: string }> };

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');

const s3 = new S3Client({ region: REGION });

// ─── Schemas ─────────────────────────────────────────────────────────────────

const SyncFromRequestSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  documentId: z.string().min(1),
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface RFPDocumentDBItem extends DBItem {
  documentId: string;
  name?: string;
  title?: string;
  documentType?: string;
  mimeType?: string;
  fileKey?: string;
  htmlContentKey?: string;
  content?: Record<string, unknown>;
  deletedAt?: string | null;
  originalFileName?: string;
  orgId?: string;
  googleDriveFileId?: string;
  googleDriveUrl?: string;
}

// ─── Auth — Domain-Wide Delegation ───────────────────────────────────────────
// Uses the same pattern as sync-to-google-drive.ts (which works).
// Service Accounts have no Drive storage quota — must impersonate a real user.

const getDriveClient = async (orgId: string): Promise<drive_v3.Drive | null> => {
  const serviceAccountJson = await getApiKey(orgId, GOOGLE_SECRET_PREFIX);
  if (!serviceAccountJson) {
    console.log(`[GoogleDrive] No service account key configured for org ${orgId}`);
    return null;
  }

  let credentials: {
    client_email?: string;
    private_key?: string;
    client_id?: string;
    delegate_email?: string;
  };

  try {
    credentials = JSON.parse(serviceAccountJson);
  } catch {
    console.error('[GoogleDrive] Service account JSON is not valid JSON');
    return null;
  }

  if (!credentials.client_email || !credentials.private_key) {
    console.error(
      '[GoogleDrive] Invalid service account key: missing client_email or private_key.',
    );
    return null;
  }

  const delegateEmail = credentials.delegate_email;
  if (!delegateEmail) {
    console.error(
      '[GoogleDrive] No delegate_email in service account JSON. ' +
      'Service Accounts have no Drive storage quota — domain-wide delegation is required. ' +
      'Add "delegate_email": "user@yourdomain.com" to the service account JSON in org settings. ' +
      'Then configure domain-wide delegation in admin.google.com: ' +
      'Security → API controls → Manage Domain Wide Delegation → ' +
      `Add Client ID ${credentials.client_id ?? '(unknown)'} with scope https://www.googleapis.com/auth/drive`,
    );
    return null;
  }

  try {
    const jwtClient = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      // Use full drive scope (not readonly) so we can read files uploaded by the same delegate
      scopes: ['https://www.googleapis.com/auth/drive'],
      subject: delegateEmail,
    });
    await jwtClient.authorize();
    console.log(`[GoogleDrive] Authorized with domain-wide delegation as ${delegateEmail}`);
    return google.drive({ version: 'v3', auth: jwtClient });
  } catch (err) {
    console.error(
      `[GoogleDrive] JWT authorization failed for delegate ${delegateEmail}: ${(err as Error)?.message}. ` +
      'Ensure domain-wide delegation is configured in admin.google.com.',
    );
    return null;
  }
};

// ─── Handler ─────────────────────────────────────────────────────────────────

export const baseHandler = async (event: APIGatewayProxyEventV2) => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { message: 'orgId is required' });
    }

    const { success, data, error } = SyncFromRequestSchema.safeParse(JSON.parse(event.body || '{}'));
    if (!success) {
      return apiResponse(400, { error: 'Invalid request', details: error.flatten() });
    }

    const { projectId, opportunityId, documentId } = data;
    const sk = `${projectId}#${opportunityId}#${documentId}`;

    // 1. Load DB record
    const doc = await getItem<RFPDocumentDBItem>(RFP_DOCUMENT_PK, sk);
    if (!doc || doc.deletedAt) {
      return apiResponse(404, { error: 'Document not found' });
    }

    if (!doc.googleDriveFileId) {
      return apiResponse(400, {
        error: 'Document has not been synced to Google Drive yet. Sync to Google Drive first.',
      });
    }

    // 2. Get Drive client
    const drive = await getDriveClient(orgId);
    if (!drive) {
      return apiResponse(400, {
        error: 'Google Drive not configured for this organization.',
        details:
          'To enable Google Drive sync, go to Organization Settings and add a Google Service Account JSON key. ' +
          'The JSON must include "delegate_email" set to a Google Workspace user with Drive storage. ' +
          'Then configure domain-wide delegation in admin.google.com: ' +
          'Security → API controls → Manage Domain Wide Delegation.',
      });
    }

    // 3. Get file metadata from Drive
    const fileMeta = await drive.files.get({
      fileId: doc.googleDriveFileId,
      fields: 'id,name,mimeType,modifiedTime',
    });

    const driveMimeType = fileMeta.data.mimeType ?? 'application/octet-stream';
    const driveFileName = fileMeta.data.name ?? doc.name ?? documentId;

    console.log(`[GoogleDrive] Downloading file ${doc.googleDriveFileId} (${driveMimeType})`);

    // 4. Download file content
    // Google Docs native files must be exported; uploaded files are downloaded directly
    let fileBuffer: Buffer;
    let effectiveMimeType = driveMimeType;

    if (driveMimeType === 'application/vnd.google-apps.document') {
      // Export Google Doc as DOCX
      const exportRes = await drive.files.export(
        {
          fileId: doc.googleDriveFileId,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        },
        { responseType: 'arraybuffer' },
      );
      fileBuffer = Buffer.from(exportRes.data as ArrayBuffer);
      effectiveMimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else {
      const downloadRes = await drive.files.get(
        { fileId: doc.googleDriveFileId, alt: 'media' },
        { responseType: 'arraybuffer' },
      );
      fileBuffer = Buffer.from(downloadRes.data as ArrayBuffer);
    }

    const sanitizedName = (doc.name || documentId).replace(/[^\w\s-]/g, '').replace(/\s+/g, '_');
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { lastSyncedAt: now };

    // 5. If DOCX — convert to HTML and store in S3 as htmlContentKey
    const isDocx =
      effectiveMimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    if (isDocx) {
      console.log(`[GoogleDrive] Converting DOCX to HTML via mammoth`);
      const { value: html } = await mammoth.convertToHtml({ buffer: fileBuffer });

      const htmlKey = `${orgId}/${projectId}/${opportunityId}/rfp-documents/${documentId}/content.html`;
      await s3.send(
        new PutObjectCommand({
          Bucket: DOCUMENTS_BUCKET,
          Key: htmlKey,
          Body: html,
          ContentType: 'text/html; charset=utf-8',
        }),
      );
      console.log(`[GoogleDrive] HTML stored at s3://${DOCUMENTS_BUCKET}/${htmlKey}`);
      updates.htmlContentKey = htmlKey;
    } else {
      // Store raw file in S3 as fileKey
      const ext = driveFileName.includes('.') ? driveFileName.split('.').pop() : '';
      const fileKey = `${orgId}/${projectId}/${opportunityId}/rfp-documents/${documentId}/from-drive/${sanitizedName}${ext ? `.${ext}` : ''}`;
      await s3.send(
        new PutObjectCommand({
          Bucket: DOCUMENTS_BUCKET,
          Key: fileKey,
          Body: fileBuffer,
          ContentType: effectiveMimeType,
        }),
      );
      console.log(`[GoogleDrive] File stored at s3://${DOCUMENTS_BUCKET}/${fileKey}`);
      updates.fileKey = fileKey;
      updates.mimeType = effectiveMimeType;
    }

    // 6. Update DB record
    await updateItem(RFP_DOCUMENT_PK, sk, updates, {});

    setAuditContext(event, {
      action: 'DATA_EXPORTED',
      resource: 'proposal',
      resourceId: documentId,
    });

    return apiResponse(200, {
      message: 'Document synced from Google Drive',
      documentId,
      isDocx,
      lastSyncedAt: now,
    });
  } catch (error) {
    console.error('Error syncing from Google Drive:', error);
    return apiResponse(500, {
      error: error instanceof Error ? error.message : 'Failed to sync from Google Drive',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
