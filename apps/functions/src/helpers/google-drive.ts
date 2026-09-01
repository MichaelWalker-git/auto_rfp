import { drive_v3, google } from 'googleapis';
import { Readable } from 'stream';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import {
  getDriveClientForOrg,
  DRIVE_SHARED_DRIVE_PARAMS,
  DRIVE_LIST_ALL_DRIVES_PARAMS,
  DRIVE_ROOT_PARENT_FOLDER_ID,
  OPPORTUNITY_SUBFOLDERS,
  buildOpportunityFolderName,
} from './google-drive-client';
import { pushDocumentToDrive } from './google-drive-document-sync';
import type { DriveSyncDocument } from './google-drive-document-sync';
import { renderBriefDocxBuffer, BRIEF_DOCX_MIME } from './brief-docx';
import { requireEnv } from './env';
import { docClient } from './db';
import { nowIso } from './date';
import { PK_NAME, SK_NAME } from '../constants/common';
import { QUESTION_FILE_PK } from '../constants/question-file';
import { RFP_DOCUMENT_PK } from '../constants/rfp-document';
import { EXEC_BRIEF_PK } from '../constants/exec-brief';
import { USER_PK } from '../constants/user';
import { userSk } from './user';
import { buildQuestionFileSK } from './questionFile';
import { createLinearComment } from './linear';
import { QuestionFileItem } from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');

const s3 = new S3Client({ region: REGION });

// Subfolder names and the intake-parent id are the single-source-of-truth copies
// in ./google-drive-client, so the per-document auto-push lands in the same tree.
const SUBFOLDERS = OPPORTUNITY_SUBFOLDERS;

// ─── Auth (Domain-Wide Delegation only) ───

/**
 * Thin wrapper over the shared client in `./google-drive-client`.
 *
 * Keeps this module's historical extra behaviour: when the service account JSON
 * carries no `delegate_email`, fall back to the first org member's email. That
 * lookup needs DynamoDB, which the shared client deliberately does not import, so
 * it is injected as a resolver here.
 */
async function getDriveClient(orgId: string): Promise<drive_v3.Drive | null> {
  const client = await getDriveClientForOrg(orgId, {
    resolveDelegateFallback: async () => {
      const emails = await getOrgMemberEmails(orgId);
      return emails[0] ?? null;
    },
  });
  return client?.drive ?? null;
}

// ─── Folder Management ───

async function findOrCreateFolder(
  drive: drive_v3.Drive,
  name: string,
  parentId?: string,
): Promise<string> {
  const escapedName = name.replace(/'/g, '\\\'');
  const query = parentId
    ? `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`
    : `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;

  const existing = await drive.files.list({
    q: query,
    fields: 'files(id, name)',
    spaces: 'drive',
    // Shared-Drive visibility: list defaults to My Drive only, so a folder that
    // lives on a Shared Drive is invisible without these — which would make
    // findOrCreate create a duplicate on every call.
    ...DRIVE_LIST_ALL_DRIVES_PARAMS,
    corpora: 'allDrives',
  });

  if (existing.data.files?.length) {
    return existing.data.files[0]!.id!;
  }

  const folder = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    },
    fields: 'id',
    ...DRIVE_SHARED_DRIVE_PARAMS,
  });

  return folder.data.id!;
}

async function getFolderUrl(drive: drive_v3.Drive, folderId: string): Promise<string | undefined> {
  try {
    const meta = await drive.files.get({
      fileId: folderId,
      fields: 'webViewLink',
      ...DRIVE_SHARED_DRIVE_PARAMS,
    });
    return meta.data.webViewLink || undefined;
  } catch {
    return undefined;
  }
}

// ─── File Upload ───

async function uploadFileFromS3(
  drive: drive_v3.Drive,
  s3Key: string,
  fileName: string,
  mimeType: string,
  folderId: string,
): Promise<{ fileId: string; webViewLink: string }> {
  const s3Response = await s3.send(
    new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: s3Key }),
  );
  if (!s3Response.Body) throw new Error(`Failed to download from S3: ${s3Key}`);

  // Convert S3 stream to Buffer first to avoid stream compatibility issues
  const chunks: Uint8Array[] = [];
  for await (const chunk of s3Response.Body as any) {
    chunks.push(chunk);
  }
  const fileBuffer = Buffer.concat(chunks);
  const stream = Readable.from(fileBuffer);

  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: stream },
    fields: 'id, webViewLink',
    ...DRIVE_SHARED_DRIVE_PARAMS,
  });

  return { fileId: res.data.id!, webViewLink: res.data.webViewLink! };
}

async function uploadBuffer(
  drive: drive_v3.Drive,
  buffer: Buffer,
  fileName: string,
  mimeType: string,
  folderId: string,
): Promise<{ fileId: string; webViewLink: string }> {
  const stream = Readable.from(buffer);
  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: stream },
    fields: 'id, webViewLink',
    ...DRIVE_SHARED_DRIVE_PARAMS,
  });
  return { fileId: res.data.id!, webViewLink: res.data.webViewLink! };
}

// ─── Sharing ───

async function shareWithEmails(
  drive: drive_v3.Drive,
  fileId: string,
  emails: string[],
  role: 'reader' | 'writer' = 'reader',
): Promise<void> {
  for (const email of emails) {
    try {
      await drive.permissions.create({
        fileId,
        requestBody: { type: 'user', role, emailAddress: email },
        sendNotificationEmail: false,
        ...DRIVE_SHARED_DRIVE_PARAMS,
      });
    } catch (err) {
      console.warn(`Failed to share with ${email}:`, (err as Error)?.message);
    }
  }
}

// ─── Data Loaders ───

async function getOrgMemberEmails(orgId: string): Promise<string[]> {
  const emails: string[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined;
  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,
        KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
        ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
        ExpressionAttributeValues: { ':pk': USER_PK, ':skPrefix': userSk(orgId, '') },
        ProjectionExpression: 'email',
        ExclusiveStartKey,
      }),
    );
    for (const item of res.Items ?? []) {
      if (item.email) emails.push(item.email);
    }
    ExclusiveStartKey = res.LastEvaluatedKey;
  } while (ExclusiveStartKey);
  return emails;
}

async function loadQuestionFilesForOpportunity(
  projectId: string,
  oppId: string,
): Promise<Array<QuestionFileItem>> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME },
      ExpressionAttributeValues: { ':pk': QUESTION_FILE_PK, ':skPrefix': `${projectId}#${oppId}#` },
    }),
  );
  return (res.Items ?? []).filter((item: any) => item.fileKey && item.status !== 'DELETED') as QuestionFileItem[];
}

/**
 * Load the full document records, not a projection: `pushDocumentToDrive` needs
 * `googleDriveFileId` to update in place instead of creating a duplicate, and
 * `htmlContentKey` to upload the current editor content.
 */
async function loadRFPDocumentsForOpportunity(
  projectId: string,
  opportunityId: string,
): Promise<DriveSyncDocument[]> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      FilterExpression: 'attribute_not_exists(#deletedAt) OR attribute_type(#deletedAt, :nullType)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME, '#deletedAt': 'deletedAt' },
      ExpressionAttributeValues: {
        ':pk': RFP_DOCUMENT_PK,
        ':skPrefix': `${projectId}#${opportunityId}#`,
        ':nullType': 'NULL',
      },
    }),
  );
  return (res.Items ?? []) as DriveSyncDocument[];
}

// ─── DB Updates ───

async function updateQuestionFileGoogleDrive(
  projectId: string, oppId: string, questionFileId: string,
  googleDriveFileId: string, googleDriveUrl: string, googleDriveFolderId: string,
): Promise<void> {
  const sk = buildQuestionFileSK(projectId, oppId, questionFileId);
  const now = nowIso();
  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: QUESTION_FILE_PK, [SK_NAME]: sk },
      UpdateExpression: 'SET #gdFileId = :gdFileId, #gdUrl = :gdUrl, #gdFolderId = :gdFolderId, #gdUploadedAt = :gdUploadedAt, #updatedAt = :now',
      ExpressionAttributeNames: {
        '#gdFileId': 'googleDriveFileId', '#gdUrl': 'googleDriveUrl',
        '#gdFolderId': 'googleDriveFolderId', '#gdUploadedAt': 'googleDriveUploadedAt', '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: {
        ':gdFileId': googleDriveFileId,
        ':gdUrl': googleDriveUrl,
        ':gdFolderId': googleDriveFolderId,
        ':gdUploadedAt': now,
        ':now': now,
      },
    }),
  );
}

async function updateBriefGoogleDrive(
  executiveBriefId: string, folderId: string, folderUrl: string,
): Promise<void> {
  const now = nowIso();
  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: EXEC_BRIEF_PK, [SK_NAME]: executiveBriefId },
      UpdateExpression: 'SET #gdFolderId = :folderId, #gdFolderUrl = :folderUrl, #gdSyncedAt = :now, #updatedAt = :now',
      ExpressionAttributeNames: {
        '#gdFolderId': 'googleDriveFolderId', '#gdFolderUrl': 'googleDriveFolderUrl',
        '#gdSyncedAt': 'googleDriveSyncedAt', '#updatedAt': 'updatedAt',
      },
      ExpressionAttributeValues: { ':folderId': folderId, ':folderUrl': folderUrl, ':now': now },
    }),
  );
}

// ─── Main Orchestrator ───

export interface GoogleDriveUploadResult {
  uploaded: number;
  skipped: number;
  errors: string[];
  folderId?: string;
  folderUrl?: string;
  subfolders: Record<string, string>;
}

/**
 * Full Google Drive sync for an approved (GO) opportunity.
 * Uses domain-wide delegation to impersonate a real user (delegate_email).
 *
 * Creates folder structure in the delegate user's Drive:
 *   [Linear-ID] - [Agency] - [Title]
 *     /Original Documents
 *     /Executive Brief
 *     /Proposal Materials
 *
 * Uploads original solicitation files, executive brief, and RFP documents.
 * Shares folder with all org team members.
 * Posts folder link to Linear issue.
 * Updates DB records with Google Drive metadata.
 */
export async function syncToGoogleDrive(args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  executiveBriefId: string;
  linearTicketId?: string;
  linearTicketIdentifier?: string;
  agencyName?: string;
  projectTitle?: string;
  briefData?: any;
}): Promise<GoogleDriveUploadResult> {
  const {
    orgId, projectId, opportunityId, executiveBriefId,
    linearTicketId, linearTicketIdentifier,
    agencyName, projectTitle, briefData,
  } = args;

  const result: GoogleDriveUploadResult = { uploaded: 0, skipped: 0, errors: [], subfolders: {} };

  try {
    // 1. Get Drive client (uses domain-wide delegation)
    const drive = await getDriveClient(orgId);
    if (!drive) {
      result.errors.push(
        'Google Drive not configured for this organization. ' +
        'Ensure a service account JSON key with "delegate_email" is configured, ' +
        'and domain-wide delegation is set up in admin.google.com.',
      );
      return result;
    }

    // 2. Build folder name: [Linear-ID] - [Agency] - [Title] (shared builder, so
    // the auto-push resolves the identical folder).
    const rootFolderName = buildOpportunityFolderName({
      linearTicketIdentifier,
      executiveBriefId,
      agencyName,
      projectTitle,
    });

    console.log(
      `[GoogleDrive] Creating folder: "${rootFolderName}"` +
      (DRIVE_ROOT_PARENT_FOLDER_ID
        ? ` under parent ${DRIVE_ROOT_PARENT_FOLDER_ID}`
        : " in delegate user's Drive"),
    );

    // 3. Create root folder (duplicate prevention — findOrCreate). When a parent
    // intake folder is configured, nest the opportunity folder inside it.
    const rootFolderId = await findOrCreateFolder(drive, rootFolderName, DRIVE_ROOT_PARENT_FOLDER_ID);
    const rootFolderUrl = await getFolderUrl(drive, rootFolderId);

    result.folderId = rootFolderId;
    result.folderUrl = rootFolderUrl;

    // 4. Create 3 subfolders
    const [originalDocsFolderId, execBriefFolderId, proposalFolderId] = await Promise.all([
      findOrCreateFolder(drive, SUBFOLDERS.originalDocuments, rootFolderId),
      findOrCreateFolder(drive, SUBFOLDERS.executiveBrief, rootFolderId),
      findOrCreateFolder(drive, SUBFOLDERS.proposalMaterials, rootFolderId),
    ]);

    result.subfolders = {
      originalDocuments: originalDocsFolderId,
      executiveBrief: execBriefFolderId,
      proposalMaterials: proposalFolderId,
    };

    // 5. Share root folder with team members
    const emails = await getOrgMemberEmails(orgId);
    if (emails.length) {
      console.log(`[GoogleDrive] Sharing folder with ${emails.length} team members`);
      await shareWithEmails(drive, rootFolderId, emails, 'writer');
    }

    // 6. Upload original solicitation files to /Original Documents
    const questionFiles = await loadQuestionFilesForOpportunity(projectId, opportunityId);
    console.log(`[GoogleDrive] Found ${questionFiles.length} question files to upload`);
    for (const file of questionFiles) {
      const rawFile = file as any;
      if (rawFile.googleDriveFileId) {
        result.skipped++;
        continue;
      }
      if (!file.fileKey) {
        console.warn(`[GoogleDrive] Skipping question file ${file.questionFileId}: no fileKey`);
        continue;
      }
      const fileName = file.originalFileName || 'document';
      const fileMime = file.mimeType || 'application/octet-stream';
      const fileOppId = file.oppId || opportunityId;
      try {
        console.log(`[GoogleDrive] Uploading original doc: ${fileName} (key: ${file.fileKey}, mime: ${fileMime})`);
        const { fileId, webViewLink } = await uploadFileFromS3(
          drive, file.fileKey, fileName, fileMime, originalDocsFolderId,
        );
        await updateQuestionFileGoogleDrive(projectId, fileOppId, file.questionFileId, fileId, webViewLink, originalDocsFolderId);
        result.uploaded++;
        console.log(`[GoogleDrive] Uploaded original doc: ${fileName} → ${webViewLink}`);
      } catch (err) {
        const errMsg = `Original doc "${fileName}": ${(err as Error)?.message}`;
        console.error(`[GoogleDrive] ${errMsg}`);
        result.errors.push(errMsg);
      }
    }

    // 7. Upload Executive Brief to /Executive Brief
    //
    // Renders the same polished .docx the "Export" button produces (shared
    // buildBriefDocument), rather than a hand-rolled plain-text summary — the
    // file dropped in Drive is now identical to what a user downloads.
    if (briefData) {
      try {
        const briefTitle =
          briefData.sections?.summary?.data?.title || projectTitle || 'Opportunity';
        const sanitizedTitle = String(briefTitle)
          .replace(/[^\w\s-]/g, '')
          .replace(/\s+/g, '_')
          .slice(0, 80) || 'Opportunity';
        const briefBuffer = await renderBriefDocxBuffer(String(briefTitle), briefData);
        await uploadBuffer(
          drive,
          briefBuffer,
          `${sanitizedTitle}_Executive_Brief.docx`,
          BRIEF_DOCX_MIME,
          execBriefFolderId,
        );
        result.uploaded++;
        console.log('[GoogleDrive] Uploaded executive brief (.docx)');
      } catch (err) {
        result.errors.push(`Executive brief: ${(err as Error)?.message}`);
      }
    }

    // 8. Upload RFP documents to /Proposal Materials
    //
    // Routed through pushDocumentToDrive so the Drive fileId is recorded on the
    // document. Previously this called files.create unconditionally and stored
    // nothing, so every opportunity re-sync left another orphaned copy in the
    // folder and the document never became linked.
    const rfpDocs = await loadRFPDocumentsForOpportunity(projectId, opportunityId);
    for (const doc of rfpDocs) {
      const docName = doc.name || doc.title || doc.documentId;
      try {
        const { updatedExisting } = await pushDocumentToDrive({
          drive,
          doc,
          orgId,
          projectId,
          opportunityId,
          documentId: doc.documentId,
          updatedBy: 'system',
          folderId: proposalFolderId,
        });
        if (updatedExisting) {
          result.skipped++;
          console.log(`[GoogleDrive] Updated existing RFP doc in Drive: ${docName}`);
        } else {
          result.uploaded++;
          console.log(`[GoogleDrive] Uploaded RFP doc: ${docName}`);
        }
      } catch (err) {
        result.errors.push(`RFP doc "${docName}": ${(err as Error)?.message}`);
      }
    }

    // 9. Update executive brief with Google Drive folder metadata
    if (rootFolderUrl) {
      try {
        await updateBriefGoogleDrive(executiveBriefId, rootFolderId, rootFolderUrl);
      } catch (err) {
        console.warn('[GoogleDrive] Failed to update brief with Drive metadata:', (err as Error)?.message);
      }
    }

    // 10. Post folder link to Linear issue as comment
    if (linearTicketId && rootFolderUrl) {
      try {
        const comment = [
          '📁 **Google Drive folder created**',
          '',
          `[Open in Google Drive](${rootFolderUrl})`,
          '',
          'Folder structure:',
          `- 📄 Original Documents (${questionFiles.length} files)`,
          `- 📋 Executive Brief`,
          `- 📝 Proposal Materials (${rfpDocs.length} files)`,
          '',
          `Shared with ${emails.length} team member(s).`,
        ].join('\n');

        await createLinearComment(orgId, linearTicketId, comment);
        console.log('[GoogleDrive] Posted Google Drive link to Linear issue');
      } catch (err) {
        result.errors.push(`Linear comment: ${(err as Error)?.message}`);
      }
    }

    console.log(`[GoogleDrive] Sync complete: ${result.uploaded} uploaded, ${result.skipped} skipped, ${result.errors.length} errors`);
    return result;
  } catch (err) {
    const msg = `Google Drive sync failed: ${(err as Error)?.message}`;
    console.error(`[GoogleDrive] ${msg}`);
    result.errors.push(msg);
    return result;
  }
}

// Re-export for backward compatibility
export const uploadQuestionFilesToGoogleDrive = syncToGoogleDrive;
