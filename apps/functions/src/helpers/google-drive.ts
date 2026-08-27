import { drive_v3, google } from 'googleapis';
import { Readable } from 'stream';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

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
import { createLinearComment, updateLinearTicketDescription } from './linear';
import { buildOfferMessage } from './linear-offer-message';
import { loadRFPDocumentHtml } from './rfp-document';
import { getExecutiveBrief } from './executive-opportunity-brief';
import { QuestionFileItem } from '@auto-rfp/core';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');
const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');
const APP_URL = process.env['APP_URL'] ?? 'https://rfp.horustech.dev';

const s3 = new S3Client({ region: REGION });

// ─── Subfolder Names (per ticket spec) ───

const SUBFOLDERS = {
  originalDocuments: 'Original Documents',
  executiveBrief: 'Executive Brief',
  proposalMaterials: 'Proposal Materials',
  finalDeliverables: 'Final Deliverables',
} as const;

// ─── Shared Drive target (HOR-2729 §2b) ───
//
// Opportunity folders are created inside the "Government Contracting" Shared
// Drive, under the "00 To be approved" intake folder. The Shared Drive ID is
// stable and configured via env; the intake folder is resolved BY NAME at
// runtime (not hardcoded) so the operator can rename/move it without a deploy.
// Reference intake folder ID (for support/debugging only): 1rxIWATfhgnMp2NXUy7jZHRQjDW74ei9-
const SHARED_DRIVE_ID = process.env['GOOGLE_SHARED_DRIVE_ID'] ?? '0AMoWTKgyidQDUk9PVA';
const INTAKE_FOLDER_NAME = process.env['GOOGLE_INTAKE_FOLDER_NAME'] ?? '00 To be approved';

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

  // Search WITHIN the target Shared Drive. Shared Drives require the drive-scoped
  // corpora + includeItemsFromAllDrives/supportsAllDrives flags; plain 'drive'
  // spaces search would not see Shared Drive items.
  const existing = await drive.files.list({
    q: query,
    fields: 'files(id, name)',
    corpora: 'drive',
    driveId: SHARED_DRIVE_ID,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
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
    supportsAllDrives: true,
  });

  return folder.data.id!;
}

/**
 * Resolve the "00 To be approved" intake folder inside the Shared Drive by
 * name, creating it if absent. New opportunity folders are parented here.
 */
async function findOrCreateIntakeRoot(drive: drive_v3.Drive): Promise<string> {
  const escapedName = INTAKE_FOLDER_NAME.replace(/'/g, '\\\'');
  const existing = await drive.files.list({
    q: `name='${escapedName}' and mimeType='application/vnd.google-apps.folder' and '${SHARED_DRIVE_ID}' in parents and trashed=false`,
    fields: 'files(id, name)',
    corpora: 'drive',
    driveId: SHARED_DRIVE_ID,
    includeItemsFromAllDrives: true,
    supportsAllDrives: true,
  });

  if (existing.data.files?.length) {
    return existing.data.files[0]!.id!;
  }

  const folder = await drive.files.create({
    requestBody: {
      name: INTAKE_FOLDER_NAME,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [SHARED_DRIVE_ID],
    },
    fields: 'id',
    supportsAllDrives: true,
  });

  return folder.data.id!;
}

async function getFolderUrl(drive: drive_v3.Drive, folderId: string): Promise<string | undefined> {
  try {
    const meta = await drive.files.get({ fileId: folderId, fields: 'webViewLink', supportsAllDrives: true });
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
    supportsAllDrives: true,
  });

  return { fileId: res.data.id!, webViewLink: res.data.webViewLink! };
}

/**
 * Upload a plain-text buffer as a NATIVE Google Doc. Setting the target
 * mimeType to `application/vnd.google-apps.document` while sending `text/plain`
 * media makes Drive convert the upload into an editable Google Doc, whose
 * webViewLink is a `docs.google.com/document/...` URL — the "Analysis" link in
 * the offer hand-off note.
 */
async function uploadTextAsGoogleDoc(
  drive: drive_v3.Drive,
  text: string,
  name: string,
  folderId: string,
): Promise<{ fileId: string; webViewLink: string }> {
  const stream = Readable.from(Buffer.from(text, 'utf-8'));
  const res = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
      mimeType: 'application/vnd.google-apps.document',
    },
    media: { mimeType: 'text/plain', body: stream },
    fields: 'id, webViewLink',
    supportsAllDrives: true,
  });
  return { fileId: res.data.id!, webViewLink: res.data.webViewLink! };
}

/**
 * Upload an HTML string as a NATIVE Google Doc, preserving formatting. Sending
 * `text/html` media against a `application/vnd.google-apps.document` target
 * makes Drive convert the markup into a formatted, editable Google Doc — used
 * for generated proposal documents, whose content is stored as HTML in S3.
 */
async function uploadHtmlAsGoogleDoc(
  drive: drive_v3.Drive,
  html: string,
  name: string,
  folderId: string,
): Promise<{ fileId: string; webViewLink: string }> {
  const stream = Readable.from(Buffer.from(html, 'utf-8'));
  const res = await drive.files.create({
    requestBody: {
      name,
      parents: [folderId],
      mimeType: 'application/vnd.google-apps.document',
    },
    media: { mimeType: 'text/html', body: stream },
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
        supportsAllDrives: true,
      });
    } catch (err) {
      // No-harm fallback: inside a Shared Drive, members already have access
      // via drive membership, so an explicit per-user grant can fail (e.g. the
      // user is already a drive member, or the delegate lacks sharing rights).
      // Downgrade to a warning rather than failing the whole sync.
      console.warn(`Failed to share with ${email} (non-blocking):`, (err as Error)?.message);
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
): Promise<Array<{
  documentId: string;
  name: string;
  status?: string;
  fileKey?: string;
  mimeType?: string;
  htmlContentKey?: string;
  content?: any;
  googleDriveFileId?: string;
}>> {
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
    status: item.status,
    fileKey: item.fileKey,
    mimeType: item.mimeType,
    htmlContentKey: item.htmlContentKey,
    content: item.content,
    googleDriveFileId: item.googleDriveFileId,
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
  analysisUrl?: string, proposalFolderId?: string,
): Promise<void> {
  const now = nowIso();
  const names: Record<string, string> = {
    '#gdFolderId': 'googleDriveFolderId', '#gdFolderUrl': 'googleDriveFolderUrl',
    '#gdSyncedAt': 'googleDriveSyncedAt', '#updatedAt': 'updatedAt',
  };
  const values: Record<string, any> = { ':folderId': folderId, ':folderUrl': folderUrl, ':now': now };
  const setParts = [
    '#gdFolderId = :folderId', '#gdFolderUrl = :folderUrl',
    '#gdSyncedAt = :now', '#updatedAt = :now',
  ];

  // Persist the Analysis Doc URL and the /Proposal Materials folder id so the
  // deferred proposal-materials sync (fired as documents become READY) can
  // re-render the full offer note — with the Documents link added — without
  // dropping the Analysis link or re-resolving the subfolder.
  if (analysisUrl) {
    names['#gdAnalysisUrl'] = 'googleDriveAnalysisUrl';
    values[':analysisUrl'] = analysisUrl;
    setParts.push('#gdAnalysisUrl = :analysisUrl');
  }
  if (proposalFolderId) {
    names['#gdProposalFolderId'] = 'googleDriveProposalFolderId';
    values[':proposalFolderId'] = proposalFolderId;
    setParts.push('#gdProposalFolderId = :proposalFolderId');
  }

  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: EXEC_BRIEF_PK, [SK_NAME]: executiveBriefId },
      UpdateExpression: `SET ${setParts.join(', ')}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    }),
  );
}

/**
 * Record the Google Drive upload metadata on an RFP document item so the
 * proposal-materials sync is idempotent — a document already carrying a
 * `googleDriveFileId` is skipped rather than re-uploaded each time another
 * document reaches READY. Mirrors {@link updateQuestionFileGoogleDrive}.
 */
async function updateRFPDocumentGoogleDrive(
  projectId: string, opportunityId: string, documentId: string,
  googleDriveFileId: string, googleDriveUrl: string, googleDriveFolderId: string,
): Promise<void> {
  const sk = `${projectId}#${opportunityId}#${documentId}`;
  const now = nowIso();
  await docClient.send(
    new UpdateCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: RFP_DOCUMENT_PK, [SK_NAME]: sk },
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

    console.log(`[GoogleDrive] Creating folder: "${rootFolderName}" under "${INTAKE_FOLDER_NAME}" in Shared Drive ${SHARED_DRIVE_ID}`);

    // 3. Resolve the "00 To be approved" intake root, then create the
    // opportunity folder inside it (duplicate prevention — findOrCreate).
    const intakeRootId = await findOrCreateIntakeRoot(drive);
    const rootFolderId = await findOrCreateFolder(drive, rootFolderName, intakeRootId);
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

    // 7. Upload Executive Brief to /Executive Brief as a native Google Doc.
    //    The Doc's webViewLink is the "Analysis" link in the Linear offer note.
    let analysisDocUrl: string | undefined;
    if (briefData) {
      try {
        const briefBuffer = await exportBriefAsBuffer(briefData);
        if (briefBuffer) {
          const { webViewLink } = await uploadTextAsGoogleDoc(
            drive,
            briefBuffer.toString('utf-8'),
            'Offer Analysis',
            execBriefFolderId,
          );
          analysisDocUrl = webViewLink;
          result.uploaded++;
          console.log(`[GoogleDrive] Uploaded executive brief as Google Doc → ${webViewLink}`);
        }
      } catch (err) {
        result.errors.push(`Executive brief: ${(err as Error)?.message}`);
      }
    }

    // 8. Update executive brief with Google Drive folder metadata. Persist the
    //    Analysis Doc URL and /Proposal Materials folder id too, so the deferred
    //    proposal-materials sync can re-render the full offer note later without
    //    dropping the Analysis link or re-resolving the subfolder.
    if (rootFolderUrl) {
      try {
        await updateBriefGoogleDrive(
          executiveBriefId, rootFolderId, rootFolderUrl, analysisDocUrl, proposalFolderId,
        );
      } catch (err) {
        console.warn('[GoogleDrive] Failed to update brief with Drive metadata:', (err as Error)?.message);
      }
    }

    // 9. Rewrite the Linear ticket body as the offer hand-off note with the
    //    Analysis (Google Doc) link. The Documents (Proposal Materials) link is
    //    intentionally deferred (HOR-2729) — it is added by syncProposalMaterials
    //    only once the proposal requirement documents have been generated, so the
    //    reviewer never receives a Documents link pointing at an empty folder.
    if (linearTicketId && rootFolderUrl) {
      try {
        const autoRfpUrl = `${APP_URL}/organizations/${orgId}/projects/${projectId}/opportunities/${opportunityId}`;
        const description = buildOfferMessage({
          analysisUrl: analysisDocUrl,
          autoRfpUrl,
        });

        const updated = await updateLinearTicketDescription(orgId, linearTicketId, description);
        if (updated) {
          console.log('[GoogleDrive] Updated Linear ticket body with offer analysis link (documents deferred)');
        } else {
          // Fall back to a comment so the links are never lost.
          await createLinearComment(orgId, linearTicketId, description);
          console.log('[GoogleDrive] Description update failed — posted offer links as a Linear comment instead');
        }
      } catch (err) {
        result.errors.push(`Linear update: ${(err as Error)?.message}`);
      }
    }

    // 10. Best-effort: if proposal requirement documents already exist (e.g. they
    //     were generated BEFORE the folder was created), upload them and add the
    //     Documents link now. Otherwise this is a no-op and the per-document
    //     generation completion path fills it in later.
    try {
      const proposalResult = await syncProposalMaterials({
        orgId, projectId, opportunityId, executiveBriefId,
        drive, proposalFolderId, rootFolderUrl,
        linearTicketId, analysisDocUrl,
      });
      result.uploaded += proposalResult.uploaded;
      result.errors.push(...proposalResult.errors);
    } catch (err) {
      result.errors.push(`Proposal materials: ${(err as Error)?.message}`);
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

export interface ProposalMaterialsResult {
  uploaded: number;
  skipped: number;
  errors: string[];
  /** True when the Documents link is present in the offer note after this run. */
  documentsLinked: boolean;
}

/**
 * Upload generated proposal requirement documents to /Proposal Materials and,
 * once at least one is present, add the "Documents" link to the Linear offer
 * note (HOR-2729).
 *
 * This is the deferred second phase of the Drive sync. It is invoked from two
 * places, so it resolves whatever context it is not given:
 *   - inline at the end of {@link syncToGoogleDrive} (drive + folder passed in),
 *     to catch proposal docs that were generated before the folder existed; and
 *   - from the document-generation worker as each document reaches READY, with
 *     only orgId/projectId/opportunityId — it then loads the brief to find the
 *     folder and NO-OPS if the Drive folder has not been created yet.
 *
 * Idempotent: documents already carrying a googleDriveFileId are skipped, and
 * the offer note is only rewritten to ADD the Documents link — subsequent docs
 * drop into the same folder without churning the link.
 */
export async function syncProposalMaterials(args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  executiveBriefId?: string;
  // Optional pre-resolved context (passed from syncToGoogleDrive).
  drive?: drive_v3.Drive | null;
  proposalFolderId?: string;
  rootFolderUrl?: string;
  linearTicketId?: string;
  analysisDocUrl?: string;
}): Promise<ProposalMaterialsResult> {
  const { orgId, projectId, opportunityId } = args;
  const result: ProposalMaterialsResult = { uploaded: 0, skipped: 0, errors: [], documentsLinked: false };

  // ── Resolve context not supplied by the caller ──
  let {
    drive, proposalFolderId, rootFolderUrl, linearTicketId, analysisDocUrl, executiveBriefId,
  } = args;

  // When invoked from the worker we only have opportunity coordinates; load the
  // brief to recover the Drive folder + Linear metadata persisted at sync time.
  const needsBrief =
    !proposalFolderId || !rootFolderUrl || (!linearTicketId && !executiveBriefId);
  let brief: any;
  if (needsBrief) {
    try {
      const sk = executiveBriefId ?? `${projectId}#${opportunityId}`;
      brief = await getExecutiveBrief(sk);
    } catch {
      brief = null;
    }

    // No Drive folder yet → nothing to sync. The GO / "Create Drive folder"
    // flow will run the full sync (and pick up existing docs) when it fires.
    if (!brief?.googleDriveProposalFolderId && !proposalFolderId) {
      console.log(
        `[GoogleDrive] syncProposalMaterials: no Drive folder for opportunity ${opportunityId} yet — skipping`,
      );
      return result;
    }

    executiveBriefId = executiveBriefId ?? brief?.[SK_NAME] ?? `${projectId}#${opportunityId}`;
    proposalFolderId = proposalFolderId ?? brief?.googleDriveProposalFolderId;
    rootFolderUrl = rootFolderUrl ?? brief?.googleDriveFolderUrl;
    linearTicketId = linearTicketId ?? brief?.linearTicketId;
    analysisDocUrl = analysisDocUrl ?? brief?.googleDriveAnalysisUrl;
  }

  if (!proposalFolderId) {
    console.log('[GoogleDrive] syncProposalMaterials: no proposal folder id — skipping');
    return result;
  }

  if (!drive) {
    drive = await getDriveClient(orgId);
    if (!drive) {
      result.errors.push('Google Drive not configured for this organization.');
      return result;
    }
  }

  // ── Upload READY proposal documents that are not yet on Drive ──
  const rfpDocs = await loadRFPDocumentsForOpportunity(projectId, opportunityId);
  const readyDocs = rfpDocs.filter((doc) => doc.status === 'READY');
  console.log(
    `[GoogleDrive] syncProposalMaterials: ${readyDocs.length} READY proposal doc(s) of ${rfpDocs.length} total for opportunity ${opportunityId}`,
  );

  for (const doc of readyDocs) {
    if (doc.googleDriveFileId) {
      result.skipped++;
      continue;
    }
    try {
      let fileId: string | undefined;
      let webViewLink: string | undefined;

      if (doc.htmlContentKey) {
        // Generated proposal content lives as HTML in S3 → convert to a Google Doc.
        const html = await loadRFPDocumentHtml(doc.htmlContentKey);
        ({ fileId, webViewLink } = await uploadHtmlAsGoogleDoc(drive, html, doc.name, proposalFolderId));
      } else if (doc.fileKey) {
        // Uploaded/binary document → upload as-is.
        ({ fileId, webViewLink } = await uploadFileFromS3(
          drive, doc.fileKey, doc.name, doc.mimeType || 'application/octet-stream', proposalFolderId,
        ));
      } else {
        // Nothing renderable yet — skip without error.
        continue;
      }

      if (fileId && webViewLink) {
        await updateRFPDocumentGoogleDrive(
          projectId, opportunityId, doc.documentId, fileId, webViewLink, proposalFolderId,
        );
        result.uploaded++;
        console.log(`[GoogleDrive] Uploaded proposal doc: ${doc.name} → ${webViewLink}`);
      }
    } catch (err) {
      result.errors.push(`Proposal doc "${doc.name}": ${(err as Error)?.message}`);
    }
  }

  // ── Add the Documents link to the offer note, only if proposal docs now exist ──
  const anyProposalDocs = readyDocs.some((doc) => doc.googleDriveFileId) || result.uploaded > 0;
  if (linearTicketId && rootFolderUrl && anyProposalDocs) {
    try {
      const autoRfpUrl = `${APP_URL}/organizations/${orgId}/projects/${projectId}/opportunities/${opportunityId}`;
      const description = buildOfferMessage({
        analysisUrl: analysisDocUrl,
        documentsUrl: rootFolderUrl,
        autoRfpUrl,
      });
      const updated = await updateLinearTicketDescription(orgId, linearTicketId, description);
      if (updated) {
        result.documentsLinked = true;
        console.log('[GoogleDrive] Added Documents link to Linear offer note (proposal materials ready)');
      } else {
        await createLinearComment(orgId, linearTicketId, description);
        result.documentsLinked = true;
        console.log('[GoogleDrive] Description update failed — posted offer links as a Linear comment instead');
      }
    } catch (err) {
      result.errors.push(`Linear documents-link update: ${(err as Error)?.message}`);
    }
  }

  return result;
}

// Re-export for backward compatibility
export const uploadQuestionFilesToGoogleDrive = syncToGoogleDrive;
