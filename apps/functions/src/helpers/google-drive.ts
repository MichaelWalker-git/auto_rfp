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
import { QuestionFileItem } from '@auto-rfp/core';

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

// ─── Auth (Domain-Wide Delegation only) ───

async function getDriveClient(orgId: string): Promise<drive_v3.Drive | null> {
  console.log(`[GoogleDrive] Getting Drive client for org ${orgId}`);
  const serviceAccountJson = await getApiKey(orgId, GOOGLE_SECRET_PREFIX);
  if (!serviceAccountJson) {
    console.log(`[GoogleDrive] No Google service account key found for org ${orgId}`);
    return null;
  }

  console.log(`[GoogleDrive] Service account JSON retrieved (length: ${serviceAccountJson.length})`);

  try {
    const credentials = JSON.parse(serviceAccountJson);

    console.log(`[GoogleDrive] Parsed credentials - client_email: ${credentials.client_email}, delegate_email: ${credentials.delegate_email || 'NOT SET'}`);

    if (!credentials.client_email || !credentials.private_key) {
      console.error(
        '[GoogleDrive] Invalid Google service account key: missing client_email or private_key. ' +
        'A Google Service Account JSON key is required (not a simple API key). ' +
        'Please update the Google Drive configuration in organization settings.',
      );
      return null;
    }

    // Determine the delegate email for domain-wide delegation
    // Priority: 1) explicit delegate_email in JSON, 2) first org member email
    let delegateEmail = credentials.delegate_email;

    if (!delegateEmail) {
      console.log(`[GoogleDrive] No delegate_email in credentials, looking up org member emails...`);
      try {
        const emails = await getOrgMemberEmails(orgId);
        console.log(`[GoogleDrive] Found ${emails.length} org member emails: ${emails.slice(0, 3).join(', ')}${emails.length > 3 ? '...' : ''}`);
        if (emails.length > 0) {
          delegateEmail = emails[0];
        }
      } catch (emailErr) {
        console.error(`[GoogleDrive] Failed to get org member emails: ${(emailErr as Error)?.message}`);
      }
    }

    if (!delegateEmail) {
      console.error(
        '[GoogleDrive] ERROR: No delegate email available. Domain-wide delegation requires a delegate_email. ' +
        'Please add "delegate_email": "user@yourdomain.com" to the service account JSON key in organization settings. ' +
        'The delegate email must be a Google Workspace user with Drive storage.',
      );
      return null;
    }

    console.log(`[GoogleDrive] Using domain-wide delegation to impersonate: ${delegateEmail}`);
    const jwtClient = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/drive'],
      subject: delegateEmail,
    });

    // Verify the delegation works by authorizing the JWT client
    try {
      await jwtClient.authorize();
      console.log(`[GoogleDrive] JWT authorization successful for delegate: ${delegateEmail}`);
    } catch (authErr) {
      console.error(
        `[GoogleDrive] JWT authorization FAILED for delegate ${delegateEmail}: ${(authErr as Error)?.message}. ` +
        'Ensure domain-wide delegation is configured in admin.google.com: ' +
        'Security → Access and data control → API controls → Manage Domain Wide Delegation. ' +
        `Add Client ID: ${credentials.client_id} with scope: https://www.googleapis.com/auth/drive`,
      );
      return null;
    }

    console.log(`[GoogleDrive] Drive client initialized successfully with delegation`);
    return google.drive({ version: 'v3', auth: jwtClient });
  } catch (err) {
    const message = (err as Error)?.message || '';
    if (message.includes('is not valid JSON')) {
      console.error(
        '[GoogleDrive] Failed to initialize Drive client: The stored credential is not valid JSON. ' +
        'A Google Service Account JSON key is required (not a simple API key). ' +
        'Please update the Google Drive configuration in organization settings.',
      );
    } else {
      console.error(`[GoogleDrive] Failed to initialize Drive client: ${message}`);
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
        ':nullType': 'NULL',
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

// ─── Executive Brief Text Export ───

async function exportBriefAsBuffer(brief: any): Promise<Buffer | null> {
  try {
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
 * Uses domain-wide delegation to impersonate a real user (delegate_email).
 *
 * Creates folder structure in the delegate user's Drive:
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

    // 2. Build folder name: [Linear-ID] - [Agency] - [Title]
    const idPart = linearTicketIdentifier || executiveBriefId.slice(0, 8);
    const agencyPart = (agencyName || 'Unknown Agency').slice(0, 50);
    const titlePart = (projectTitle || 'Opportunity').slice(0, 80);
    const rootFolderName = `${idPart} - ${agencyPart} - ${titlePart}`;

    console.log(`[GoogleDrive] Creating folder: "${rootFolderName}" in delegate user's Drive`);

    // 3. Create root folder in the delegate user's Drive (duplicate prevention — findOrCreate)
    const rootFolderId = await findOrCreateFolder(drive, rootFolderName);
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
    if (briefData) {
      try {
        const briefBuffer = await exportBriefAsBuffer(briefData);
        if (briefBuffer) {
          await uploadBuffer(drive, briefBuffer, 'Executive_Opportunity_Brief.txt', 'text/plain', execBriefFolderId);
          result.uploaded++;
          console.log('[GoogleDrive] Uploaded executive brief');
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
          await uploadFileFromS3(drive, doc.fileKey, doc.name, doc.mimeType || 'application/octet-stream', proposalFolderId);
          result.uploaded++;
          console.log(`[GoogleDrive] Uploaded RFP doc: ${doc.name}`);
        } else if (doc.content) {
          const contentBuffer = Buffer.from(JSON.stringify(doc.content, null, 2), 'utf-8');
          await uploadBuffer(drive, contentBuffer, `${doc.name}.json`, 'application/json', proposalFolderId);
          result.uploaded++;
          console.log(`[GoogleDrive] Uploaded RFP doc content: ${doc.name}`);
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
          `- ✅ Final Deliverables`,
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
