import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { z } from 'zod';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { apiResponse, getOrgId } from '@/helpers/api';
import { getItem, updateItem } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import { getApiKey } from '@/helpers/api-key-storage';
import { GOOGLE_SECRET_PREFIX } from '@/constants/google';
import { RFP_DOCUMENT_PK } from '@/constants/rfp-document';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { drive_v3, google } from 'googleapis';
import { Readable } from 'stream';
import type { DBItem } from '@/helpers/db';

/** Map document types to Google Drive folder names (win-optimized proposal order) */
const DOCUMENT_TYPE_FOLDERS: Record<string, string> = {
  // Core proposal sections
  COVER_LETTER: 'Cover Letters',
  EXECUTIVE_SUMMARY: 'Executive Summaries',
  UNDERSTANDING_OF_REQUIREMENTS: 'Understanding of Requirements',
  TECHNICAL_PROPOSAL: 'Technical Proposals',
  PROJECT_PLAN: 'Project Plans',
  TEAM_QUALIFICATIONS: 'Team Qualifications',
  PAST_PERFORMANCE: 'Past Performance',
  COST_PROPOSAL: 'Cost Proposals',
  MANAGEMENT_APPROACH: 'Management Approach',
  RISK_MANAGEMENT: 'Risk Management',
  COMPLIANCE_MATRIX: 'Compliance Matrices',
  CERTIFICATIONS: 'Certifications',
  APPENDICES: 'Appendices',
  // Supporting / administrative
  EXECUTIVE_BRIEF: 'Executive Briefs',
  MANAGEMENT_PROPOSAL: 'Management Proposals',
  PRICE_VOLUME: 'Price Volume',
  QUALITY_MANAGEMENT: 'Quality Management Plans',
  TEAMING_AGREEMENT: 'Teaming Agreements',
  NDA: 'NDAs',
  CONTRACT: 'Contracts',
  AMENDMENT: 'Amendments',
  CORRESPONDENCE: 'Correspondence',
  OTHER: 'Other Documents',
};

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');

const s3 = new S3Client({ region: REGION });

const SyncRequestSchema = z.object({
  projectId: z.string().min(1),
  opportunityId: z.string().min(1),
  documentId: z.string().min(1),
});

interface RFPDocumentDBItem extends DBItem {
  documentId: string;
  name?: string;
  documentType?: string;
  mimeType?: string;
  fileKey?: string;
  content?: unknown;
  deletedAt?: string | null;
  originalFileName?: string;
}

// ─── Auth — Domain-Wide Delegation ───
// Service Accounts have no storage quota on personal Drive.
// We MUST use domain-wide delegation (JWT with subject) to impersonate
// a real Google Workspace user who has Drive storage.

async function getDriveClientWithDelegation(orgId: string): Promise<drive_v3.Drive | null> {
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
      '[GoogleDrive] Invalid service account key: missing client_email or private_key. ' +
      'A full Google Service Account JSON key is required.',
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
      scopes: ['https://www.googleapis.com/auth/drive'],
      subject: delegateEmail, // impersonate a real user with Drive storage
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
}

// ─── Folder Management ───

async function findOrCreateFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId?: string,
): Promise<string> {
  const escapedName = name.replace(/'/g, "\\'");
  const query = [
    `name='${escapedName}'`,
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false',
    parentId ? `'${parentId}' in parents` : undefined,
  ].filter(Boolean).join(' and ');

  const existing = await drive.files.list({
    q: query,
    fields: 'files(id,name)',
    spaces: 'drive',
  });

  if (existing.data.files?.length) {
    return existing.data.files[0]!.id!;
  }

  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id',
  });

  return created.data.id!;
}

// ─── Handler ───

export const baseHandler = async (event: APIGatewayProxyEventV2) => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { message: 'Org Id is required' });
    }

    const { success, data, error } = SyncRequestSchema.safeParse(JSON.parse(event.body || ''));
    if (!success) {
      return apiResponse(400, { error: 'Invalid request', details: error.flatten() });
    }

    const { projectId, opportunityId, documentId } = data;
    const sk = `${projectId}#${opportunityId}#${documentId}`;

    // 1. Get the document from DB
    const doc = await getItem<RFPDocumentDBItem>(RFP_DOCUMENT_PK, sk);
    if (!doc || doc.deletedAt) {
      return apiResponse(404, { error: 'Document not found' });
    }

    // 2. Get Drive client using domain-wide delegation
    //    (Service Accounts have no storage quota — must impersonate a real user)
    const drive = await getDriveClientWithDelegation(orgId);
    if (!drive) {
      return apiResponse(400, {
        error: 'Google Drive not configured for this organization.',
        details:
          'Service Accounts require domain-wide delegation to upload files. ' +
          'Add "delegate_email": "user@yourdomain.com" to the service account JSON in org settings, ' +
          'then configure domain-wide delegation in admin.google.com.',
      });
    }

    // 3. Create folder structure: RFP Documents / <projectId> / <Document Type Folder>
    const typeFolderName = DOCUMENT_TYPE_FOLDERS[doc.documentType ?? 'OTHER'] ?? DOCUMENT_TYPE_FOLDERS.OTHER!;
    const rootFolderId = await findOrCreateFolder(drive, 'RFP Documents');
    const projectFolderId = await findOrCreateFolder(drive, projectId, rootFolderId);
    const typeFolderId = await findOrCreateFolder(drive, typeFolderName, projectFolderId);

    let googleDriveFileId: string;
    let googleDriveUrl: string;

    if (doc.fileKey) {
      // 4a. Upload file from S3
      const s3Result = await s3.send(
        new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: doc.fileKey }),
      );

      const chunks: Buffer[] = [];
      for await (const chunk of s3Result.Body as Readable) {
        chunks.push(Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      const uploadResult = await drive.files.create({
        requestBody: {
          name: doc.name || doc.originalFileName || documentId,
          parents: [typeFolderId],
          mimeType: doc.mimeType || 'application/octet-stream',
        },
        media: {
          mimeType: doc.mimeType || 'application/octet-stream',
          body: Readable.from(buffer),
        },
        fields: 'id,webViewLink',
      });

      googleDriveFileId = uploadResult.data.id!;
      googleDriveUrl = uploadResult.data.webViewLink!;
    } else if (doc.content) {
      // 4b. Upload structured content as JSON
      const contentStr = JSON.stringify(doc.content, null, 2);
      const fileName = `${doc.name || documentId}.json`;

      const uploadResult = await drive.files.create({
        requestBody: {
          name: fileName,
          parents: [typeFolderId],
          mimeType: 'application/json',
        },
        media: {
          mimeType: 'application/json',
          body: Readable.from(Buffer.from(contentStr, 'utf-8')),
        },
        fields: 'id,webViewLink',
      });

      googleDriveFileId = uploadResult.data.id!;
      googleDriveUrl = uploadResult.data.webViewLink!;
    } else {
      return apiResponse(400, { error: 'Document has no file or content to sync' });
    }

    // 5. Update DB record with Google Drive metadata
    await updateItem(
      RFP_DOCUMENT_PK,
      sk,
      { googleDriveFileId, googleDriveUrl },
      { condition: 'attribute_exists(#pk) AND attribute_exists(#sk)' },
    );

    
    setAuditContext(event, {
      action: 'DATA_EXPORTED',
      resource: 'proposal',
      resourceId: event.pathParameters?.documentId ?? event.queryStringParameters?.documentId ?? 'unknown',
    });

    return apiResponse(200, {
      message: 'Document synced to Google Drive',
      googleDriveFileId,
      googleDriveUrl,
    });
  } catch (error) {
    console.error('Error syncing RFP document to Google Drive:', error);
    const message =
      error instanceof Error ? error.message : 'Failed to sync document to Google Drive';
    return apiResponse(500, { error: message });
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
