import { drive_v3, google } from 'googleapis';
import { Readable } from 'stream';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import { getApiKey } from './api-key-storage';
import { GOOGLE_SECRET_PREFIX } from '../constants/google';
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
import { QuestionFileItem } from '@auto-rfp/shared';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');

const s3 = new S3Client({ region: REGION });

// ─── Subfolder Names (per ticket spec) ───

const SUBFOLDERS = {
  originalDocuments: 'Original Documents',
  executiveBrief: 'Executive Brief',
  proposalMaterials: 'Proposal Materials',
  finalDeliverables: 'Final Deliverables',
} as const;

// ─── Auth ───

async function getDriveClient(orgId: string): Promise<drive_v3.Drive | null> {
  const serviceAccountJson = await getApiKey(orgId, GOOGLE_SECRET_PREFIX);
  if (!serviceAccountJson) {
    console.log(`No Google service account key found for org ${orgId}`);
    return null;
  }

  try {
    const credentials = JSON.parse(serviceAccountJson);

    if (!credentials.client_email || !credentials.private_key) {
      console.error(
        'Invalid Google service account key: missing client_email or private_key. ' +
        'A Google Service Account JSON key is required (not a simple API key). ' +
        'Please update the Google Drive configuration in organization settings.',
      );
      return null;
    }

    // If delegate_email is provided in the credentials, use domain-wide delegation
    // to impersonate that user (solves the "no storage quota" issue for service accounts)
    const delegateEmail = credentials.delegate_email;

    let auth;
    if (delegateEmail) {
      console.log(`Using domain-wide delegation to impersonate: ${delegateEmail}`);
      const jwtClient = new google.auth.JWT({
        email: credentials.client_email,
        key: credentials.private_key,
        scopes: ['https://www.googleapis.com/auth/drive'],
        subject: delegateEmail,
      });
      auth = jwtClient;
    } else {
      // Try to get org member email for impersonation (first member as delegate)
      const emails = await getOrgMemberEmails(orgId);
      if (emails.length > 0) {
        console.log(`Using domain-wide delegation to impersonate org member: ${emails[0]}`);
        const jwtClient = new google.auth.JWT({
          email: credentials.client_email,
          key: credentials.private_key,
          scopes: ['https://www.googleapis.com/auth/drive'],
          subject: emails[0],
        });
        auth = jwtClient;
      } else {
        console.log('No delegate email found, using service account directly (may fail with storage quota error)');
        auth = new google.auth.GoogleAuth({
          credentials,
          scopes: ['https://www.googleapis.com/auth/drive'],
        });
      }
    }

    return google.drive({ version: 'v3', auth });
  } catch (err) {
    const message = (err as Error)?.message || '';
    if (message.includes('is not valid JSON')) {
      console.error(
        'Failed to initialize Google Drive client: The stored credential is not valid JSON. ' +
        'A Google Service Account JSON key is required (not a simple API key). ' +
        'Please update the Google Drive configuration in organization settings.',
      );
    } else {
      console.error('Failed to initialize Google Drive client:', message);
    }
    return null;
  }
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
  });

  return folder.data.id!;
}

async function getFolderUrl(drive: drive_v3.Drive, folderId: string): Promise<string | undefined> {
  try {
    const meta = await drive.files.get({ fileId: folderId, fields: 'webViewLink' });
    return meta.data.webViewLink || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Find a shared folder that the service account can use as a parent.
 * Service accounts have no storage quota, so all files must be created
 * inside a folder that was shared with the service account email.
 * 
 * Searches for folders shared with the service account, then shared drives.
 * If none found, returns undefined and the sync will fail early with a clear error.
 */
async function getSharedParentFolderId(drive: drive_v3.Drive): Promise<string | undefined> {
  try {
    // Strategy 1: Look for folders shared with the service account
    const sharedRes = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.folder' and sharedWithMe=true and trashed=false",
      fields: 'files(id, name)',
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    if (sharedRes.data.files?.length) {
      const folder = sharedRes.data.files[0]!;
      console.log(`Using shared folder as parent: "${folder.name}" (${folder.id})`);
      return folder.id!;
    }

    // Strategy 2: Look for any accessible folder (shared drives, etc.)
    const anyRes = await drive.files.list({
      q: "mimeType='application/vnd.google-apps.folder' and trashed=false",
      fields: 'files(id, name, driveId)',
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    // Prefer folders from shared drives (they have driveId)
    const sharedDriveFolder = anyRes.data.files?.find((f: any) => f.driveId);
    if (sharedDriveFolder) {
      console.log(`Using shared drive folder as parent: "${sharedDriveFolder.name}" (${sharedDriveFolder.id})`);
      return sharedDriveFolder.id!;
    }

    console.error(
      'ERROR: No shared folders found for the service account. ' +
      'Service accounts have no storage quota and cannot create files in their own Drive. ' +
      'To fix this: 1) Create a folder in Google Drive, 2) Share it with the service account email (Editor access). ' +
      'The service account email can be found in the JSON key file under "client_email".',
    );
    return undefined;
  } catch (err) {
    console.warn('Failed to find shared parent folder:', (err as Error)?.message);
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
    supportsAllDrives: true,
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
    supportsAllDrives: true,
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

async function loadRFPDocumentsForOpportunity(
  projectId: string,
  opportunityId: string,
): Promise<Array<{ documentId: string; name: string; fileKey?: string; mimeType?: string; content?: any }>> {
  const res = await docClient.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :skPrefix)',
      FilterExpression: 'attribute_not_exists(#deletedAt) OR attribute_type(#deletedAt, :nullType)',
      ExpressionAttributeNames: { '#pk': PK_NAME, '#sk': SK_NAME, '#deletedAt': 'deletedAt' },
      ExpressionAttributeValues: {
        ':pk': RFP_DOCUMENT_PK,
        ':skPrefix': `${projectId}#${opportunityId}#`,
        ':nullType': 'NULL'
      },
    }),
  );
  return (res.Items ?? []).map((item: any) => ({
    documentId: item.documentId,
    name: item.name || item.title || 'document',
    fileKey: item.fileKey,
    mimeType: item.mimeType,
    content: item.content,
  }));
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
        ':now': now
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

// ─── Executive Brief DOCX Export (client-side style) ───

async function exportBriefAsBuffer(brief: any): Promise<Buffer | null> {
  try {
    // Build a simple text representation of the brief for upload
    const parts: string[] = [];
    const sections = brief.sections as Record<string, any> | undefined;
    if (!sections) return null;

    parts.push(`Executive Opportunity Brief`);
    parts.push(`Project: ${brief.projectId}`);
    parts.push(`Decision: ${brief.decision || 'N/A'}`);
    parts.push(`Score: ${brief.compositeScore || 'N/A'}/5`);
    parts.push(`Confidence: ${brief.confidence || 'N/A'}%`);
    parts.push('');

    if (sections.summary?.data) {
      const s = sections.summary.data;
      parts.push('=== SUMMARY ===');
      if (s.title) parts.push(`Title: ${s.title}`);
      if (s.agency) parts.push(`Agency: ${s.agency}`);
      if (s.summary) parts.push(`\n${s.summary}`);
      parts.push('');
    }

    if (sections.requirements?.data?.overview) {
      parts.push('=== REQUIREMENTS ===');
      parts.push(sections.requirements.data.overview);
      parts.push('');
    }

    if (sections.risks?.data) {
      parts.push('=== RISKS ===');
      (sections.risks.data.redFlags || []).forEach((f: any) => parts.push(`- [${f.severity}] ${f.flag}`));
      parts.push('');
    }

    if (sections.scoring?.data) {
      const sc = sections.scoring.data;
      parts.push('=== SCORING ===');
      parts.push(`Decision: ${sc.decision}`);
      parts.push(`Justification: ${sc.summaryJustification || ''}`);
      (sc.criteria || []).forEach((c: any) => parts.push(`- ${c.name}: ${c.score}/5 — ${c.rationale}`));
      parts.push('');
    }

    return Buffer.from(parts.join('\n'), 'utf-8');
  } catch (err) {
    console.warn('Failed to export brief as buffer:', (err as Error)?.message);
    return null;
  }
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
 *
 * Creates folder structure per ticket spec:
 *   [Linear-ID] - [Agency] - [Title]
 *     /Original Documents
 *     /Executive Brief
 *     /Proposal Materials
 *     /Final Deliverables
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
    // 1. Get Drive client
    const drive = await getDriveClient(orgId);
    if (!drive) {
      result.errors.push('Google Drive not configured for this organization');
      return result;
    }

    // 2. Build folder name: [Linear-ID] - [Agency] - [Title]
    const idPart = linearTicketIdentifier || executiveBriefId.slice(0, 8);
    const agencyPart = (agencyName || 'Unknown Agency').slice(0, 50);
    const titlePart = (projectTitle || 'Opportunity').slice(0, 80);
    const rootFolderName = `${idPart} - ${agencyPart} - ${titlePart}`;

    // 2b. Get the shared parent folder ID (service accounts have no storage quota,
    // so files must be created inside a folder shared with the service account)
    const sharedParentFolderId = await getSharedParentFolderId(drive);

    if (!sharedParentFolderId) {
      result.errors.push(
        'No shared Google Drive folder found. Please share a folder with the service account email ' +
        '(found in the JSON key under "client_email") with Editor access, then retry.',
      );
      return result;
    }

    console.log(`Creating Google Drive folder: "${rootFolderName}" under shared folder ${sharedParentFolderId}`);

    // 3. Create root folder (duplicate prevention — findOrCreate)
    const rootFolderId = await findOrCreateFolder(drive, rootFolderName, sharedParentFolderId);
    const rootFolderUrl = await getFolderUrl(drive, rootFolderId);

    result.folderId = rootFolderId;
    result.folderUrl = rootFolderUrl;

    // 4. Create 4 subfolders
    const [originalDocsFolderId, execBriefFolderId, proposalFolderId, finalFolderId] = await Promise.all([
      findOrCreateFolder(drive, SUBFOLDERS.originalDocuments, rootFolderId),
      findOrCreateFolder(drive, SUBFOLDERS.executiveBrief, rootFolderId),
      findOrCreateFolder(drive, SUBFOLDERS.proposalMaterials, rootFolderId),
      findOrCreateFolder(drive, SUBFOLDERS.finalDeliverables, rootFolderId),
    ]);

    result.subfolders = {
      originalDocuments: originalDocsFolderId,
      executiveBrief: execBriefFolderId,
      proposalMaterials: proposalFolderId,
      finalDeliverables: finalFolderId,
    };

    // 5. Share root folder with team members
    const emails = await getOrgMemberEmails(orgId);
    if (emails.length) {
      console.log(`Sharing folder with ${emails.length} team members`);
      await shareWithEmails(drive, rootFolderId, emails, 'writer');
    }

    // 6. Upload original solicitation files to /Original Documents
    const questionFiles = await loadQuestionFilesForOpportunity(projectId, opportunityId);
    console.log(`Found ${questionFiles.length} question files to upload`);
    for (const file of questionFiles) {
      const rawFile = file as any;
      if (rawFile.googleDriveFileId) {
        result.skipped++;
        continue;
      }
      if (!file.fileKey) {
        console.warn(`Skipping question file ${file.questionFileId}: no fileKey`);
        continue;
      }
      const fileName = file.originalFileName || 'document';
      const fileMime = file.mimeType || 'application/octet-stream';
      const fileOppId = file.oppId || opportunityId;
      try {
        console.log(`Uploading original doc: ${fileName} (key: ${file.fileKey}, mime: ${fileMime})`);
        const { fileId, webViewLink } = await uploadFileFromS3(
          drive, file.fileKey, fileName, fileMime, originalDocsFolderId,
        );
        await updateQuestionFileGoogleDrive(projectId, fileOppId, file.questionFileId, fileId, webViewLink, originalDocsFolderId);
        result.uploaded++;
        console.log(`Uploaded original doc: ${fileName} → ${webViewLink}`);
      } catch (err) {
        const errMsg = `Original doc "${fileName}": ${(err as Error)?.message}`;
        console.error(errMsg);
        result.errors.push(errMsg);
      }
    }

    // 7. Upload Executive Brief to /Executive Brief
    if (briefData) {
      try {
        const briefBuffer = await exportBriefAsBuffer(briefData);
        if (briefBuffer) {
          await uploadBuffer(drive, briefBuffer, 'Executive_Opportunity_Brief.txt', 'text/plain', execBriefFolderId);
          result.uploaded++;
          console.log('Uploaded executive brief');
        }
      } catch (err) {
        result.errors.push(`Executive brief: ${(err as Error)?.message}`);
      }
    }

    // 8. Upload RFP documents to /Proposal Materials
    const rfpDocs = await loadRFPDocumentsForOpportunity(projectId, opportunityId);
    for (const doc of rfpDocs) {
      try {
        if (doc.fileKey) {
          // Upload from S3
          await uploadFileFromS3(drive, doc.fileKey, doc.name, doc.mimeType || 'application/octet-stream', proposalFolderId);
          result.uploaded++;
          console.log(`Uploaded RFP doc: ${doc.name}`);
        } else if (doc.content) {
          // Upload structured content as JSON
          const contentBuffer = Buffer.from(JSON.stringify(doc.content, null, 2), 'utf-8');
          await uploadBuffer(drive, contentBuffer, `${doc.name}.json`, 'application/json', proposalFolderId);
          result.uploaded++;
          console.log(`Uploaded RFP doc content: ${doc.name}`);
        }
      } catch (err) {
        result.errors.push(`RFP doc "${doc.name}": ${(err as Error)?.message}`);
      }
    }

    // 9. Update executive brief with Google Drive folder metadata
    if (rootFolderUrl) {
      try {
        await updateBriefGoogleDrive(executiveBriefId, rootFolderId, rootFolderUrl);
      } catch (err) {
        console.warn('Failed to update brief with Drive metadata:', (err as Error)?.message);
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
          `- ✅ Final Deliverables`,
          '',
          `Shared with ${emails.length} team member(s).`,
        ].join('\n');

        await createLinearComment(orgId, linearTicketId, comment);
        console.log('Posted Google Drive link to Linear issue');
      } catch (err) {
        result.errors.push(`Linear comment: ${(err as Error)?.message}`);
      }
    }

    console.log(`Google Drive sync complete: ${result.uploaded} uploaded, ${result.skipped} skipped, ${result.errors.length} errors`);
    return result;
  } catch (err) {
    const msg = `Google Drive sync failed: ${(err as Error)?.message}`;
    console.error(msg);
    result.errors.push(msg);
    return result;
  }
}

// Re-export for backward compatibility
export const uploadQuestionFilesToGoogleDrive = syncToGoogleDrive;
