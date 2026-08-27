/**
 * google-drive-document-sync.ts
 *
 * Bidirectional document sync between an RFP document and a **native Google Doc**.
 * All domain logic lives here so the REST handlers stay thin and the scheduled
 * poller can reuse the same code path.
 *
 * Direction of truth, and why it terminates: `driveModifiedTime` records the Drive
 * `modifiedTime` AutoRFP has already accounted for, in either direction. A push
 * stores the `modifiedTime` returned by its own mutation, so the next poll sees
 * equality and does not pull. A pull writes only DynamoDB and S3, and nothing
 * consumes that to push back — so there is no reverse edge and no loop.
 */

import { Readable } from 'stream';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { drive_v3 } from 'googleapis';
import { ROLE_PERMISSIONS, type EditHistoryEntry } from '@auto-rfp/core';
import { v4 as uuidv4 } from 'uuid';
import mammoth from 'mammoth';

import { getItem, isConditionalCheckFailed, updateItem } from './db';
import type { DBItem } from './db';
import { requireEnv } from './env';
import { nowIso } from './date';
import { uploadToS3 } from './s3';
import { RFP_DOCUMENT_PK } from '../constants/rfp-document';
import { loadDocumentHtmlForExport, sanitizeFileName } from './export';
import { htmlToDocxBuffer } from './export-docx';
import {
  createVersion,
  getLatestVersionNumber,
  saveVersionHtml,
} from './rfp-document-version';
import { updateRFPDocumentMetadata, uploadRFPDocumentHtml } from './rfp-document';
import { listOrgMemberAccess, type OrgMemberAccess } from './org';
import { cancelPendingApprovals, listApprovalsByDocument } from './document-approval';
import { buildNotification, sendNotification } from './send-notification';
import { buildRfpDocumentReviewLink } from './approval-links';
import { writeAuditLog } from './audit-log';
import { getHmacSecret } from './secret';
import {
  DOCX_MIME,
  GOOGLE_DOC_MIME,
  getDriveClientForOrg,
  isDriveForbidden,
  isDriveNotFound,
  isDriveRateLimited,
} from './google-drive-client';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');
const REGION = requireEnv('REGION', 'us-east-1');

const s3 = new S3Client({ region: REGION });

/** A SYNCING claim older than this is assumed dead (crashed Lambda) and may be taken over. */
const STALE_CLAIM_MS = 10 * 60 * 1000;

/**
 * Refuse to import anything larger than this. mammoth and docx both hold whole
 * buffers in memory, so an unbounded pull OOMs the Lambda and reports a bare 500;
 * a guard turns that into a message an operator can act on.
 */
const MAX_DRIVE_FILE_BYTES = 25 * 1024 * 1024;

/**
 * `createdBy` on a version is a uuid in the core schema, but a scheduled pull has
 * no user. The nil uuid keeps the record schema-valid; `createdByName` carries the
 * human-readable attribution.
 */
const SYSTEM_ACTOR_ID = '00000000-0000-0000-0000-000000000000';
const SYSTEM_ACTOR_NAME = 'Google Drive sync';

/** Fields requested on every Drive mutation, so the watermark comes from the mutation itself. */
const DRIVE_MUTATION_FIELDS = 'id,name,webViewLink,modifiedTime,mimeType';

/** Map document types to Drive folder names (win-optimized proposal order). */
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
  // Question / clarification workflows
  CLARIFYING_QUESTIONS: 'Clarifying Questions',
  QUESTIONS_AND_ANSWERS: 'Questions and Answers',
  QUESTIONNAIRE: 'Questionnaires',
  OTHER: 'Other Documents',
};

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * The stored shape this module reads. Extends the single-table key type with the
 * document attributes involved in Drive sync; the full domain entity lives in
 * `@auto-rfp/core` but the raw record is what DynamoDB hands back.
 */
export interface DriveSyncDocument extends DBItem {
  documentId: string;
  projectId?: string;
  opportunityId?: string;
  orgId?: string;
  name?: string;
  title?: string;
  documentType?: string;
  mimeType?: string;
  /** Document lifecycle status (e.g. GENERATING → READY) — the proposal-materials sync only pushes READY docs. */
  status?: string;
  fileKey?: string;
  htmlContentKey?: string;
  originalFileName?: string;
  content?: Record<string, unknown>;
  deletedAt?: string | null;
  updatedBy?: string;
  editHistory?: EditHistoryEntry[] | null;
  signatureStatus?: string;
  googleDriveFileId?: string | null;
  googleDriveUrl?: string | null;
  driveMimeType?: string | null;
  driveFolderId?: string | null;
  driveModifiedTime?: string | null;
  drivePendingModifiedTime?: string | null;
  driveLastPushedAt?: string | null;
  driveLastPulledAt?: string | null;
  driveSyncStatus?: string | null;
  driveSyncError?: string | null;
  driveSyncStartedAt?: string | null;
}

export interface PushResult {
  googleDriveFileId: string;
  googleDriveUrl: string;
  driveMimeType: string;
  driveModifiedTime: string;
  driveLastPushedAt: string;
  /** True when an existing Drive file was updated in place rather than created. */
  updatedExisting: boolean;
}

export interface PullResult {
  /** False when Drive has not moved since the recorded watermark — nothing was written. */
  changed: boolean;
  /** Set when the import created an HTML version snapshot. */
  versionNumber?: number;
  /** Set when the import was refused because the document is approved. */
  blocked?: boolean;
  /** Set when another sync already holds the claim, so the caller can answer 409. */
  inProgress?: boolean;
  /** Reason for a block, or the trashed-file explanation. */
  reason?: string;
  /** The Drive `modifiedTime` this pass observed, whether or not it was imported. */
  driveModifiedTime?: string;
  driveLastPulledAt?: string;
  /** True when an approved document was imported under an explicit override. */
  overrodeApproval?: boolean;
  /** True when the import landed on a document with an open review and reviewers were told. */
  notifiedPendingReviewers?: boolean;
}

// ─── Utilities ───────────────────────────────────────────────────────────────

/**
 * The sparse GSI that makes polling affordable. `RFP_DOCUMENT`'s own SK has no `orgId`
 * segment, so the main table cannot be scoped to one org — and these keys are written
 * only while a document is linked, so the ~99% of documents with no Drive link cost
 * nothing to carry. Declared in `packages/infra/database-stack.ts`.
 */
export const DRIVE_SYNC_INDEX_NAME = 'byDriveSync';
export const DRIVE_SYNC_PK_ATTRIBUTE = 'driveSyncPk';
export const DRIVE_SYNC_SK_ATTRIBUTE = 'driveSyncSk';

export const buildDriveSyncSk = (
  projectId: string,
  opportunityId: string,
  documentId: string,
): string => `${projectId}#${opportunityId}#${documentId}`;

/** Drive error messages can be enormous; DynamoDB items and UI badges are not. */
export const truncateSyncError = (message: string, max = 400): string =>
  message.length > max ? `${message.slice(0, max - 1)}…` : message;

/**
 * Retry a Drive call while it fails with a retryable status (429/5xx). Google
 * rate-limits per user, and a poll over many documents is exactly the shape that
 * trips it.
 */
export const withDriveRetry = async <T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<T> => {
  const { attempts = 3, baseDelayMs = 500 } = opts;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (!isDriveRateLimited(err) || attempt === attempts - 1) throw err;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
};

/**
 * Take an exclusive sync claim on a document. Returns false when another sync
 * holds a non-stale claim — the caller should report "already syncing" rather
 * than racing it.
 *
 * The claim and the watermark are deliberately separate writes: if the import
 * then crashes, the watermark is untouched and the Drive edit is retried instead
 * of being silently discarded.
 */
export const claimDriveSync = async (args: {
  projectId: string;
  opportunityId: string;
  documentId: string;
}): Promise<boolean> => {
  const sk = buildDriveSyncSk(args.projectId, args.opportunityId, args.documentId);
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();

  try {
    await updateItem(
      RFP_DOCUMENT_PK,
      sk,
      { driveSyncStatus: 'SYNCING', driveSyncStartedAt: nowIso() },
      {
        condition:
          'attribute_exists(#pk) AND (attribute_not_exists(#dss) OR #dss <> :syncing OR attribute_not_exists(#dsa) OR #dsa < :stale)',
        conditionNames: { '#dss': 'driveSyncStatus', '#dsa': 'driveSyncStartedAt' },
        conditionValues: { ':syncing': 'SYNCING', ':stale': staleBefore },
      },
    );
    return true;
  } catch (err) {
    if (isConditionalCheckFailed(err)) return false;
    throw err;
  }
};

/** Record a failed sync without touching content or the watermark. */
export const markDriveSyncFailed = async (args: {
  projectId: string;
  opportunityId: string;
  documentId: string;
  message: string;
}): Promise<void> => {
  const sk = buildDriveSyncSk(args.projectId, args.opportunityId, args.documentId);
  await updateItem(
    RFP_DOCUMENT_PK,
    sk,
    { driveSyncStatus: 'SYNC_FAILED', driveSyncError: truncateSyncError(args.message) },
    {},
  );
};

// ─── Folder resolution ───────────────────────────────────────────────────────

/**
 * Find a Drive folder by name under an optional parent, creating it when absent.
 * Single copy — the handler previously carried a duplicate of this.
 */
export const findOrCreateFolder = async (
  drive: drive_v3.Drive,
  name: string,
  parentId?: string,
): Promise<string> => {
  // Drive query strings are single-quoted; escape any quote in the name.
  const escapedName = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const query = [
    `name='${escapedName}'`,
    "mimeType='application/vnd.google-apps.folder'",
    'trashed=false',
    parentId ? `'${parentId}' in parents` : undefined,
  ]
    .filter(Boolean)
    .join(' and ');

  const existing = await withDriveRetry(() =>
    drive.files.list({ q: query, fields: 'files(id,name)', spaces: 'drive' }),
  );

  const found = existing.data.files?.[0]?.id;
  if (found) return found;

  const created = await withDriveRetry(() =>
    drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {}),
      },
      fields: 'id',
    }),
  );

  const createdId = created.data.id;
  if (!createdId) throw new Error(`Drive did not return an id for folder "${name}"`);
  return createdId;
};

/**
 * Resolve `RFP Documents / <projectId> / <type folder>`, preferring the cached
 * `driveFolderId` so a re-sync costs zero folder round-trips.
 */
/**
 * The Drive role a member should hold, capped by what they can already do in AutoRFP.
 *
 * Derived from `ROLE_PERMISSIONS` rather than a hardcoded role list, because the whole
 * point is that Drive access cannot exceed in-app access: granting `writer` to someone
 * who lacks `proposal:edit` would route around the app's own permission model, and
 * `sync-from-google-drive` requires exactly that permission. A member with no
 * `proposal:read` gets nothing at all — BILLING today.
 *
 * Returns null when the member should not be shared with.
 */
const driveRoleForMember = (member: OrgMemberAccess): 'writer' | 'reader' | null => {
  if (!member.role) return null;
  const permissions = ROLE_PERMISSIONS[member.role] ?? [];
  if (permissions.includes('proposal:edit')) return 'writer';
  if (permissions.includes('proposal:read')) return 'reader';
  return null;
};

/**
 * True when Drive rejected a silent grant purely because the address has no Google
 * account behind it, and would accept the same grant if the recipient were notified.
 *
 * Matched on the message because the Drive API reports this as a generic 400 with no
 * distinguishing reason code — so the check is deliberately narrow, keyed on both the
 * missing-account explanation and the notify instruction, to avoid retrying a genuine
 * policy refusal (an org that forbids external sharing outright) that a notification
 * would not fix.
 */
const requiresNotificationToShare = (err: unknown): boolean => {
  const message = (err as Error)?.message ?? '';
  return (
    /no Google account/i.test(message) &&
    /notify\s*people/i.test(message)
  );
};

/**
 * Grants an org's members access to a Drive folder, so the Google Docs inside it are
 * actually openable by the people meant to collaborate on them.
 *
 * Without this every file AutoRFP creates is owned by the delegate and shared with
 * nobody — which makes converting to a native Google Doc pointless, since the only
 * account that can open it is a service identity no human uses.
 *
 * Shares the **folder**, not each document: Drive access is inherited, so one grant
 * covers every document that ever lands here. Per-document sharing would cost a call
 * per member per push, and Drive's per-user rate limits are the poller's binding
 * constraint.
 *
 * Never throws. A failed grant leaves the document synced but unopenable by that
 * person, which is strictly better than failing the sync — and the common causes are
 * outside our control: an already-existing grant, or a Workspace policy refusing an
 * external address (this org's members include several gmail.com accounts).
 */
export const shareFolderWithOrgMembers = async (args: {
  drive: drive_v3.Drive;
  folderId: string;
  orgId: string;
}): Promise<{ shared: number; skipped: number; failed: number }> => {
  const { drive, folderId, orgId } = args;
  const outcome = { shared: 0, skipped: 0, failed: 0 };

  let members: OrgMemberAccess[];
  try {
    members = await listOrgMemberAccess(orgId);
  } catch (err) {
    console.warn(
      `[GoogleDrive] Could not list members of ${orgId} to share folder ${folderId}: ${(err as Error)?.message}`,
    );
    return outcome;
  }

  // Skip anyone who already has access. The folder tree is shared, so a "new" type
  // folder often already carries grants from a previous document — re-granting costs a
  // 2-3 second round trip each and, for addresses with no Google account, re-sends a
  // notification email to a real person.
  let alreadyGranted = new Set<string>();
  try {
    const { data } = await withDriveRetry(() =>
      drive.permissions.list({
        fileId: folderId,
        fields: 'permissions(emailAddress)',
        pageSize: 100,
      }),
    );
    alreadyGranted = new Set(
      (data.permissions ?? [])
        .map((p) => p.emailAddress?.toLowerCase())
        .filter((e): e is string => !!e),
    );
  } catch (err) {
    // Non-fatal: without the list we simply attempt every grant, which is the old
    // behaviour — duplicates are rejected harmlessly.
    console.warn(
      `[GoogleDrive] Could not read existing permissions on ${folderId}: ${(err as Error)?.message}`,
    );
  }

  // Concurrent, not sequential. A single permissions.create takes 2-3 seconds, and an
  // org of 19 members therefore took ~28s serially — which blew API Gateway's hard 30s
  // integration timeout and surfaced to the user as "service unavailable" on a push that
  // had actually succeeded. Bounded at 5 so a large org cannot trip Drive's rate limits.
  const SHARE_CONCURRENCY = 5;

  const shareOne = async (member: OrgMemberAccess): Promise<void> => {
    const role = driveRoleForMember(member);
    if (!role) {
      outcome.skipped += 1;
      return;
    }

    if (alreadyGranted.has(member.email.toLowerCase())) {
      outcome.skipped += 1;
      return;
    }

    const grant = (sendNotificationEmail: boolean) =>
      withDriveRetry(() =>
        drive.permissions.create({
          fileId: folderId,
          requestBody: { type: 'user', role, emailAddress: member.email },
          sendNotificationEmail,
        }),
      );

    try {
      // Quietly first: the folder is machine-created plumbing, and members reach the
      // document through AutoRFP, so a Drive notification is normally inbox noise.
      await grant(false);
      outcome.shared += 1;
    } catch (err) {
      // Drive refuses a silent grant to an address with no Google account behind it —
      // it will only create such an invite if the recipient is notified. Several real
      // members are in exactly that position, and leaving them out would silently deny
      // access to the people the feature exists for, so retry loudly for that one case.
      if (requiresNotificationToShare(err)) {
        try {
          await grant(true);
          outcome.shared += 1;
          console.log(
            `[GoogleDrive] Granted ${role} on ${folderId} to ${member.email} with a notification ` +
              `(no Google account is associated with that address, so Drive requires one)`,
          );
          return;
        } catch (retryErr) {
          outcome.failed += 1;
          console.warn(
            `[GoogleDrive] Could not grant ${role} on folder ${folderId} to ${member.email} ` +
              `even with a notification: ${(retryErr as Error)?.message}`,
          );
          return;
        }
      }

      // Re-granting an existing permission is an error in the Drive API, and this runs
      // again whenever a folder is re-resolved — so a duplicate is the expected case,
      // not a fault.
      outcome.failed += 1;
      console.warn(
        `[GoogleDrive] Could not grant ${role} on folder ${folderId} to ${member.email}: ${(err as Error)?.message}`,
      );
    }
  };

  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(SHARE_CONCURRENCY, members.length) }, async () => {
      while (cursor < members.length) {
        const member = members[cursor++];
        if (member) await shareOne(member);
      }
    }),
  );

  // `shared` counts accepted API calls, which is NOT the number of people who gained
  // access: Drive resolves an address to a Google account, so Gmail aliases of one
  // account (foo@ and foo+x@) collapse into a single permission. Treat it as "grants
  // attempted successfully", and read drive.permissions.list for actual coverage.
  console.log(
    `[GoogleDrive] Folder ${folderId} sharing for org ${orgId}: ` +
      `${outcome.shared} grant(s) accepted, ${outcome.skipped} skipped (insufficient in-app access), ` +
      `${outcome.failed} rejected by Drive`,
  );
  return outcome;
};

export const resolveDocumentFolder = async (args: {
  drive: drive_v3.Drive;
  doc: DriveSyncDocument;
  projectId: string;
  /**
   * Org whose members should be granted access to a newly-resolved folder. Optional so
   * the opportunity-level sync, which shares its own root folder already, can opt out.
   */
  orgId?: string;
}): Promise<string> => {
  const { drive, doc, projectId, orgId } = args;
  if (doc.driveFolderId) return doc.driveFolderId;

  const typeFolderName =
    DOCUMENT_TYPE_FOLDERS[doc.documentType ?? 'OTHER'] ?? DOCUMENT_TYPE_FOLDERS.OTHER!;

  const rootFolderId = await findOrCreateFolder(drive, 'RFP Documents');
  const projectFolderId = await findOrCreateFolder(drive, projectId, rootFolderId);
  const typeFolderId = await findOrCreateFolder(drive, typeFolderName, projectFolderId);

  // Only on this branch: an already-cached driveFolderId returned above means the folder
  // was resolved on an earlier push and has been shared already, so re-granting every
  // time would burn a Drive call per member per push to no effect.
  if (orgId) {
    await shareFolderWithOrgMembers({ drive, folderId: typeFolderId, orgId });
  }

  return typeFolderId;
};

// ─── Body preparation ────────────────────────────────────────────────────────

const readS3ObjectToBuffer = async (key: string): Promise<Buffer> => {
  const res = await s3.send(new GetObjectCommand({ Bucket: DOCUMENTS_BUCKET, Key: key }));
  const chunks: Buffer[] = [];
  for await (const chunk of res.Body as Readable) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
};

interface DriveUploadBody {
  /** Name to give the Drive file (no extension for native Docs). */
  name: string;
  /** MIME type of the bytes we are sending. */
  mediaMimeType: string;
  /**
   * Target MIME type for Drive to store. `GOOGLE_DOC_MIME` asks Drive to convert
   * the upload into a native, collaboratively editable Doc. `undefined` means
   * "store the bytes as-is" — correct for PDFs and other binaries, which must not
   * be mangled into Docs.
   */
  targetMimeType?: string;
  buffer: Buffer;
}

/**
 * Build the bytes to send to Drive.
 *
 * `htmlContentKey` takes priority over `fileKey` so a re-sync always reflects the
 * latest editor content rather than a stale upload. HTML is rendered through the
 * app's own exporter (`htmlToDocxBuffer`), which handles ordered lists, nesting,
 * tables and images correctly — the handler used to carry an inferior private
 * parser that rendered numbered lists as bullets.
 */
export const prepareDriveUploadBody = async (
  doc: DriveSyncDocument,
): Promise<DriveUploadBody> => {
  const documentId = doc.documentId;

  if (doc.htmlContentKey) {
    const html = await loadDocumentHtmlForExport(doc as unknown as Record<string, unknown>);
    if (!html.trim()) {
      throw new Error('Document HTML content is empty');
    }

    const title =
      doc.title || (typeof doc.content?.title === 'string' ? doc.content.title : undefined) ||
      doc.name ||
      documentId;

    const buffer = await htmlToDocxBuffer(html, { title });
    return {
      // Native Google Docs have no file extension.
      name: sanitizeFileName(title),
      mediaMimeType: DOCX_MIME,
      targetMimeType: GOOGLE_DOC_MIME,
      buffer,
    };
  }

  if (doc.fileKey) {
    const buffer = await readS3ObjectToBuffer(doc.fileKey);
    const mimeType = doc.mimeType || 'application/octet-stream';
    return {
      name: doc.name || doc.originalFileName || documentId,
      mediaMimeType: mimeType,
      // No conversion — a PDF should stay a PDF in Drive.
      targetMimeType: undefined,
      buffer,
    };
  }

  if (doc.content) {
    const contentStr = JSON.stringify(doc.content, null, 2);
    return {
      name: `${doc.name || documentId}.json`,
      mediaMimeType: 'application/json',
      targetMimeType: undefined,
      buffer: Buffer.from(contentStr, 'utf-8'),
    };
  }

  throw new Error('Document has no file, HTML content, or structured content to sync');
};

// ─── Push: AutoRFP → Drive ───────────────────────────────────────────────────

/**
 * Push the document's current content to Drive, creating the file on first sync
 * and **updating it in place** on every sync after that.
 *
 * The update-in-place is the fix for the original defect: the handler always
 * called `files.create`, so each re-sync left another orphaned copy in the folder
 * and re-pointed the document at the newest one.
 */
export const pushDocumentToDrive = async (args: {
  drive: drive_v3.Drive;
  doc: DriveSyncDocument;
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  updatedBy: string;
  /**
   * Target Drive folder, overriding the `RFP Documents/<project>/<type>` tree.
   * The opportunity-level sync passes its own `/Proposal Materials` folder so the
   * document lands beside the rest of that opportunity's material.
   */
  folderId?: string;
}): Promise<PushResult> => {
  const { drive, doc, orgId, projectId, opportunityId, documentId, updatedBy } = args;
  const sk = buildDriveSyncSk(projectId, opportunityId, documentId);

  // orgId is passed so a newly-created folder is shared with the org's members —
  // otherwise the resulting Google Doc is openable only by the service delegate.
  // An explicit args.folderId comes from the opportunity sync, which shares its own.
  const folderId =
    args.folderId ?? (await resolveDocumentFolder({ drive, doc, projectId, orgId }));
  const body = await prepareDriveUploadBody(doc);

  const media = { mimeType: body.mediaMimeType, body: Readable.from(body.buffer) };

  const createFile = async (): Promise<drive_v3.Schema$File> => {
    const res = await withDriveRetry(() =>
      drive.files.create({
        requestBody: {
          name: body.name,
          parents: [folderId],
          // The *target* type: setting this to a Google MIME triggers conversion.
          ...(body.targetMimeType ? { mimeType: body.targetMimeType } : {}),
        },
        media: { mimeType: body.mediaMimeType, body: Readable.from(body.buffer) },
        fields: DRIVE_MUTATION_FIELDS,
      }),
    );
    return res.data;
  };

  let file: drive_v3.Schema$File;
  let updatedExisting = false;

  if (doc.googleDriveFileId) {
    try {
      const res = await withDriveRetry(() =>
        drive.files.update({
          fileId: doc.googleDriveFileId!,
          // NOTE: `parents` is not valid in files.update's requestBody (400);
          // moving a file uses addParents/removeParents.
          requestBody: { name: body.name },
          media,
          fields: DRIVE_MUTATION_FIELDS,
        }),
      );
      file = res.data;
      updatedExisting = true;
    } catch (err) {
      if (isDriveForbidden(err)) {
        // The file still exists but this delegate can't touch it (deprovisioned or
        // unshared). Re-creating here is precisely how duplicates are produced.
        throw err;
      }
      if (!isDriveNotFound(err)) throw err;

      // Genuinely gone — recreate exactly once.
      console.warn(
        `[GoogleDrive] Linked file ${doc.googleDriveFileId} not found; recreating for document ${documentId}`,
      );
      file = await createFile();
    }
  } else {
    file = await createFile();
  }

  const googleDriveFileId = file.id;
  const driveModifiedTime = file.modifiedTime;
  if (!googleDriveFileId || !driveModifiedTime) {
    throw new Error('Drive response omitted id or modifiedTime');
  }

  const googleDriveUrl =
    file.webViewLink ?? `https://drive.google.com/file/d/${googleDriveFileId}/view`;
  const driveMimeType = file.mimeType ?? body.targetMimeType ?? body.mediaMimeType;
  const driveLastPushedAt = nowIso();

  await updateItem(
    RFP_DOCUMENT_PK,
    sk,
    {
      googleDriveFileId,
      googleDriveUrl,
      driveMimeType,
      driveFolderId: folderId,
      // Watermark taken from this mutation's own response. A follow-up files.get
      // could capture a collaborator's newer timestamp and thereby lose their edit.
      driveModifiedTime,
      driveLastPushedAt,
      driveSyncStatus: 'SYNCED',
      driveSyncError: null,
      driveSyncStartedAt: null,
      // Sparse GSI keys — written only while the document is linked.
      driveSyncPk: orgId,
      driveSyncSk: sk,
      updatedBy,
    },
    { condition: 'attribute_exists(#pk) AND attribute_exists(#sk)' },
  );

  return {
    googleDriveFileId,
    googleDriveUrl,
    driveMimeType,
    driveModifiedTime,
    driveLastPushedAt,
    updatedExisting,
  };
};

// ─── Approved snapshot: a frozen record of what was signed off ───────────────

/** Folder holding approved snapshots, kept apart from the editable working copies. */
const APPROVED_SNAPSHOT_FOLDER = 'Approved Snapshots';

/**
 * Captures the approved content as a **separate, read-only** Google Doc, so there is a
 * record in Drive of exactly what a reviewer signed off on.
 *
 * Why a second file rather than a marker on the existing one: `googleDriveFileId` stays
 * the live editing pointer and keeps changing. A record of "what was approved" has to
 * stop changing the moment it is written, and the only way to guarantee that is a
 * different file that nothing else writes to.
 *
 * The snapshot is shared read-only with the org and never re-pushed. If approval happens
 * twice (a reopened document approved again), the previous snapshot is left in place and
 * a new one is written — the history of approvals is more useful than a single current
 * one, and overwriting would destroy the earlier record.
 *
 * Returns null when there is nothing to capture or the capture failed. Callers MUST treat
 * this as non-blocking: approval is a business-critical path and must not fail because
 * Google was briefly unavailable.
 */
export const captureApprovedSnapshot = async (args: {
  drive: drive_v3.Drive;
  doc: DriveSyncDocument;
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  approvedVersion?: number;
}): Promise<{
  fileId: string;
  url: string;
  capturedAt: string;
  version?: number;
} | null> => {
  const { drive, doc, orgId, projectId, opportunityId, documentId, approvedVersion } = args;

  try {
    const body = await prepareDriveUploadBody(doc);

    // Its own folder tree, so an approved snapshot can never be confused with the
    // editable copy the sync writes to.
    const rootFolderId = await findOrCreateFolder(drive, 'RFP Documents');
    const projectFolderId = await findOrCreateFolder(drive, projectId, rootFolderId);
    const snapshotFolderId = await findOrCreateFolder(
      drive,
      APPROVED_SNAPSHOT_FOLDER,
      projectFolderId,
    );

    // The timestamp is in the name because multiple approvals produce multiple
    // snapshots, and a reader needs to tell them apart in the Drive UI.
    const capturedAt = nowIso();
    const versionLabel = approvedVersion ? `v${approvedVersion}` : 'approved';
    const snapshotName = sanitizeFileName(
      `${body.name} — APPROVED ${versionLabel} (${capturedAt.slice(0, 10)})`,
    );

    const created = await withDriveRetry(() =>
      drive.files.create({
        requestBody: {
          name: snapshotName,
          parents: [snapshotFolderId],
          mimeType: body.targetMimeType,
          description:
            `Frozen record of the content approved on ${capturedAt}. ` +
            'Do not edit — AutoRFP does not sync this file.',
        },
        media: { mimeType: body.mediaMimeType, body: Readable.from(body.buffer) },
        fields: 'id,webViewLink',
      }),
    );

    const fileId = created.data.id;
    if (!fileId) {
      console.warn(`[GoogleDrive] Snapshot creation returned no id for ${documentId}`);
      return null;
    }

    // Read-only for everyone: a snapshot that can be edited is not a record.
    // Copy/print/download stays enabled, since auditors need to be able to take it away.
    await shareFolderWithOrgMembers({ drive, folderId: snapshotFolderId, orgId }).catch(() => ({
      shared: 0,
      skipped: 0,
      failed: 0,
    }));

    await updateRFPDocumentMetadata({
      projectId,
      opportunityId,
      documentId,
      updates: {
        driveApprovedSnapshotFileId: fileId,
        driveApprovedSnapshotUrl: created.data.webViewLink ?? null,
        driveApprovedSnapshotAt: capturedAt,
        ...(approvedVersion ? { driveApprovedSnapshotVersion: approvedVersion } : {}),
      },
      updatedBy: 'system',
    });

    console.log(
      `[GoogleDrive] Captured approved snapshot ${fileId} for document ${documentId} ` +
        `(${versionLabel})`,
    );

    return {
      fileId,
      url: created.data.webViewLink ?? '',
      capturedAt,
      ...(approvedVersion ? { version: approvedVersion } : {}),
    };
  } catch (err) {
    // Never rethrow: this runs inside the approval path, and an approval must not fail
    // because a Drive artefact could not be written.
    console.warn(
      `[GoogleDrive] Could not capture approved snapshot for ${documentId}: ${(err as Error)?.message}`,
    );
    return null;
  }
};

/**
 * Fire-and-forget entry point for the approval handlers: capture the approved snapshot if
 * this org uses Drive and this document has content, otherwise do nothing.
 *
 * Everything is swallowed by design. This is called from `submit-review` and
 * `bulk-review`, which gate proposal submission — the only acceptable failure mode here
 * is a log line.
 */
export const captureApprovedSnapshotIfConfigured = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
}): Promise<void> => {
  const { orgId, projectId, opportunityId, documentId } = args;

  try {
    const doc = await loadDriveSyncDocument({ projectId, opportunityId, documentId });
    if (!doc) return;

    // Nothing to freeze. Note this does NOT require an existing Drive link: a document
    // approved without ever being pushed still deserves a record of what was approved.
    if (!doc.htmlContentKey && !doc.fileKey) return;

    const client = await getDriveClientForOrg(orgId);
    if (!client) return;

    const latestVersion = await getLatestVersionNumber(
      projectId,
      opportunityId,
      documentId,
    ).catch(() => undefined);

    await captureApprovedSnapshot({
      drive: client.drive,
      doc,
      orgId,
      projectId,
      opportunityId,
      documentId,
      ...(typeof latestVersion === 'number' ? { approvedVersion: latestVersion } : {}),
    });
  } catch (err) {
    console.warn(
      `[GoogleDrive] Approved-snapshot capture skipped for ${documentId}: ${(err as Error)?.message}`,
    );
  }
};

// ─── Pull: Drive → AutoRFP ───────────────────────────────────────────────────

/** Epoch ms, or `null` when absent/unparseable. RFC3339 must never be string-compared. */
const toEpochMs = (iso?: string | null): number | null => {
  if (!iso) return null;
  const parsed = Date.parse(iso);
  return Number.isNaN(parsed) ? null : parsed;
};

/** Extension for a stored Drive image, derived from its content type. */
const imageExtension = (contentType: string): string => {
  const subtype = contentType.split('/')[1]?.split(/[+;]/)[0]?.toLowerCase();
  if (!subtype) return 'bin';
  if (subtype === 'jpeg') return 'jpg';
  if (subtype === 'svg') return 'svg';
  return subtype.replace(/[^a-z0-9]/g, '') || 'bin';
};

/**
 * The `<img>` attributes mammoth's `imgElement` converter accepts. Its shipped
 * type declares only `src`, but the runtime spreads whatever the callback returns
 * onto the element (`images.js` → `_.extend(attributes, result)`), so the
 * `data-s3-key` the rest of the app keys off is emitted verbatim.
 */
interface DriveImageAttributes {
  src: string;
  'data-s3-key': string;
}

/**
 * Convert an exported DOCX to HTML, re-hosting every embedded image in S3.
 *
 * This is not optional. Bare `convertToHtml` inlines images as base64 `data:`
 * URIs, and the editor's `stripPresignedUrlsFromHtml` removes inline data URIs on
 * save — so without re-extraction every pulled image silently vanishes the first
 * time a user saves the document.
 */
const convertDriveDocxToHtml = async (args: {
  buffer: Buffer;
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
}): Promise<string> => {
  const { buffer, orgId, projectId, opportunityId, documentId } = args;
  const imagePrefix = `${orgId}/${projectId}/${opportunityId}/rfp-documents/${documentId}/drive-images`;

  const { value } = await mammoth.convertToHtml(
    { buffer },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const imageBuffer = await image.readAsBuffer();
        const key = `${imagePrefix}/${uuidv4()}.${imageExtension(image.contentType)}`;
        await uploadToS3(DOCUMENTS_BUCKET, key, imageBuffer, image.contentType);
        // `s3key:` in src plus data-s3-key is the pair helpers/export.ts and the
        // TipTap image extension both resolve to presigned URLs at render time.
        const attributes: DriveImageAttributes = { src: `s3key:${key}`, 'data-s3-key': key };
        return attributes;
      }),
    },
  );

  return value;
};

/** Everyone who should hear that an approved document was edited in Drive. */
const resolveApprovalAudience = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  doc: DriveSyncDocument;
}): Promise<string[]> => {
  const { orgId, projectId, opportunityId, documentId, doc } = args;

  const approvals = await listApprovalsByDocument(orgId, projectId, opportunityId, documentId).catch(
    (err: unknown) => {
      console.warn(
        `[GoogleDrive] Could not list approvals for ${documentId}: ${(err as Error)?.message}`,
      );
      return [];
    },
  );

  const recipients = new Set<string>();
  for (const approval of approvals) {
    if (approval.reviewerId) recipients.add(approval.reviewerId);
    if (approval.requestedBy) recipients.add(approval.requestedBy);
  }
  if (doc.updatedBy) recipients.add(doc.updatedBy);
  return [...recipients];
};

/**
 * Reviewers with a review still open on this document, plus whoever asked for it.
 *
 * Distinct from {@link resolveApprovalAudience}, which is every party to any approval
 * past or present — appropriate for "this was blocked", but too broad for "the content
 * you are reviewing just changed", which only concerns a live review.
 *
 * Returns an empty array on failure: a notification is not worth failing an import for.
 */
const resolvePendingReviewers = async (args: {
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
}): Promise<string[]> => {
  const { orgId, projectId, opportunityId, documentId } = args;

  const approvals = await listApprovalsByDocument(
    orgId,
    projectId,
    opportunityId,
    documentId,
  ).catch((err: unknown) => {
    console.warn(
      `[GoogleDrive] Could not check pending reviews for ${documentId}: ${(err as Error)?.message}`,
    );
    return [];
  });

  const recipients = new Set<string>();
  for (const approval of approvals) {
    if (approval.status !== 'PENDING') continue;
    if (approval.reviewerId) recipients.add(approval.reviewerId);
    if (approval.requestedBy) recipients.add(approval.requestedBy);
  }

  return [...recipients];
};

/** Fire-and-forget audit write; a failed audit must not fail the sync. */
const writeDriveSyncAudit = async (args: {
  orgId: string;
  documentId: string;
  action: 'INTEGRATION_SYNC_COMPLETED' | 'INTEGRATION_SYNC_FAILED';
  userId: string;
  userName: string;
  result: 'success' | 'failure';
  errorMessage?: string;
  changes?: { before?: Record<string, unknown>; after?: Record<string, unknown> };
}): Promise<void> => {
  try {
    await writeAuditLog(
      {
        logId: uuidv4(),
        timestamp: nowIso(),
        userId: args.userId,
        userName: args.userName,
        organizationId: args.orgId,
        action: args.action,
        resource: 'rfp_document',
        resourceId: args.documentId,
        ...(args.changes ? { changes: args.changes } : {}),
        ipAddress: '0.0.0.0',
        userAgent: 'system',
        result: args.result,
        ...(args.errorMessage ? { errorMessage: args.errorMessage } : {}),
      },
      await getHmacSecret(),
    );
  } catch (err) {
    console.warn(
      `[GoogleDrive] Audit write failed (non-blocking): ${(err as Error)?.message}`,
    );
  }
};

/**
 * Import the Drive file into AutoRFP, but only when Drive has actually moved on.
 *
 * Called by both the manual "Sync now" handler and the scheduled poller, so every
 * guard lives here rather than in either caller. Never advances the watermark on
 * failure: a crashed import must leave the Drive edit pending, not discard it.
 */
export const pullDocumentFromDriveIfChanged = async (args: {
  drive: drive_v3.Drive;
  doc: DriveSyncDocument;
  orgId: string;
  projectId: string;
  opportunityId: string;
  documentId: string;
  /** The acting user, or undefined for the scheduled poller. */
  actorUserId?: string;
  actorName?: string;
  /**
   * Import an approved document anyway, reopening its approval. Manual path only —
   * the poller must never take this decision on a user's behalf.
   */
  acceptApprovedOverride?: boolean;
}): Promise<PullResult> => {
  const {
    drive,
    doc,
    orgId,
    projectId,
    opportunityId,
    documentId,
    acceptApprovedOverride = false,
  } = args;

  const fileId = doc.googleDriveFileId;
  if (!fileId) {
    throw new Error('Document is not linked to a Google Drive file');
  }

  const actorUserId = args.actorUserId ?? SYSTEM_ACTOR_ID;
  const actorName = args.actorName ?? SYSTEM_ACTOR_NAME;

  // 1. Gate read. `trashed` matters: a trashed file still resolves, and downloading
  //    it would replace live content with whatever was there when it was deleted.
  const meta = await withDriveRetry(() =>
    drive.files.get({ fileId, fields: 'id,name,mimeType,modifiedTime,trashed,size' }),
  );

  if (meta.data.trashed) {
    const reason = 'The linked Google Drive file is in the trash. Restore it or re-push from AutoRFP.';
    await markDriveSyncFailed({ projectId, opportunityId, documentId, message: reason });
    return { changed: false, reason };
  }

  const remoteModifiedTime = meta.data.modifiedTime;
  if (!remoteModifiedTime) {
    // Without a timestamp there is no watermark to compare or advance, so importing
    // would mean re-importing on every pass forever.
    return { changed: false, reason: 'Google Drive did not report a modifiedTime for this file.' };
  }

  const remoteMs = toEpochMs(remoteModifiedTime);
  const knownMs = toEpochMs(doc.driveModifiedTime);

  // 2. Change gate — zero writes when Drive has not moved.
  if (remoteMs === null || (knownMs !== null && remoteMs <= knownMs)) {
    return { changed: false, driveModifiedTime: remoteModifiedTime };
  }

  const driveFileName = meta.data.name ?? doc.name ?? documentId;

  // 3. Approved documents: block before downloading anything.
  //    The submission gate reads only `signatureStatus`, so a silent import would
  //    turn "approved" into a claim about content nobody approved.
  const isApproved = doc.signatureStatus === 'FULLY_SIGNED';
  if (isApproved && !acceptApprovedOverride) {
    const reason =
      `"${driveFileName}" was edited in Google Drive after approval. ` +
      'The import was blocked to protect the approved content — use "Import anyway" to accept it, ' +
      'which reopens the approval.';

    await updateItem(
      RFP_DOCUMENT_PK,
      buildDriveSyncSk(projectId, opportunityId, documentId),
      {
        driveSyncStatus: 'BLOCKED_APPROVED',
        driveSyncError: truncateSyncError(reason),
        // Remember the change we refused so the next poll doesn't re-alert every
        // 15 minutes, while leaving the real watermark untouched so an override
        // still sees the edit as pending.
        drivePendingModifiedTime: remoteModifiedTime,
        driveSyncStartedAt: null,
      },
      {},
    );

    const alreadyAlerted = toEpochMs(doc.drivePendingModifiedTime) === remoteMs;
    if (!alreadyAlerted) {
      const recipientUserIds = await resolveApprovalAudience({
        orgId,
        projectId,
        opportunityId,
        documentId,
        doc,
      });

      if (recipientUserIds.length > 0) {
        await sendNotification(
          buildNotification(
            'DRIVE_EDIT_BLOCKED_APPROVED',
            '⚠️ Google Drive edit blocked',
            `"${driveFileName}" was edited in Google Drive after it was approved. ` +
              'The change was not imported.',
            {
              orgId,
              projectId,
              entityId: `${opportunityId}:${documentId}`,
              recipientUserIds,
              actorDisplayName: actorName,
              link: buildRfpDocumentReviewLink(orgId, projectId, opportunityId, documentId),
            },
          ),
        ).catch((err: unknown) =>
          console.warn(`[GoogleDrive] Block notification failed: ${(err as Error)?.message}`),
        );
      }
    }

    await writeDriveSyncAudit({
      orgId,
      documentId,
      action: 'INTEGRATION_SYNC_FAILED',
      userId: actorUserId,
      userName: actorName,
      result: 'failure',
      errorMessage: reason,
    });

    return { changed: false, blocked: true, reason, driveModifiedTime: remoteModifiedTime };
  }

  // 3b. Document is out for review but not yet approved. The import proceeds — a
  //     pending review is not yet a claim of correctness, and blocking would stall
  //     ordinary editing while someone happens to have a review open. But the reviewer
  //     must be told, because otherwise the content changes underneath them and they
  //     could approve text they never read.
  const pendingReviewers = acceptApprovedOverride
    ? []
    : await resolvePendingReviewers({ orgId, projectId, opportunityId, documentId });

  // 4. Claim, so the manual button and the poller can't import the same edit twice.
  const claimed = await claimDriveSync({ projectId, opportunityId, documentId });
  if (!claimed) {
    return {
      changed: false,
      inProgress: true,
      reason: 'A sync is already in progress for this document.',
    };
  }

  try {
    const remoteMimeType = meta.data.mimeType ?? 'application/octet-stream';
    const isNativeDoc = remoteMimeType === GOOGLE_DOC_MIME;

    const declaredSize = Number(meta.data.size ?? 0);
    if (declaredSize > MAX_DRIVE_FILE_BYTES) {
      throw new Error(
        `Google Drive file is ${Math.round(declaredSize / 1024 / 1024)} MB, above the ` +
          `${MAX_DRIVE_FILE_BYTES / 1024 / 1024} MB import limit.`,
      );
    }

    // 5. Download: native Docs must be exported, everything else is fetched as-is.
    let buffer: Buffer;
    let effectiveMimeType = remoteMimeType;

    if (isNativeDoc) {
      const exported = await withDriveRetry(() =>
        drive.files.export({ fileId, mimeType: DOCX_MIME }, { responseType: 'arraybuffer' }),
      );
      buffer = Buffer.from(exported.data as ArrayBuffer);
      effectiveMimeType = DOCX_MIME;
    } else {
      const downloaded = await withDriveRetry(() =>
        drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' }),
      );
      buffer = Buffer.from(downloaded.data as ArrayBuffer);
    }

    if (buffer.byteLength > MAX_DRIVE_FILE_BYTES) {
      throw new Error(
        `Google Drive file is ${Math.round(buffer.byteLength / 1024 / 1024)} MB, above the ` +
          `${MAX_DRIVE_FILE_BYTES / 1024 / 1024} MB import limit.`,
      );
    }

    const driveLastPulledAt = nowIso();
    const driveFields = {
      driveMimeType: remoteMimeType,
      // Advance the watermark to the value from the *gate* read, so a file changed
      // mid-download is caught next pass rather than skipped.
      driveModifiedTime: remoteModifiedTime,
      drivePendingModifiedTime: null,
      driveLastPulledAt,
      driveSyncStatus: 'SYNCED',
      driveSyncError: null,
      driveSyncStartedAt: null,
      driveSyncPk: orgId,
      driveSyncSk: buildDriveSyncSk(projectId, opportunityId, documentId),
    } as const;

    if (!effectiveMimeType.startsWith(DOCX_MIME)) {
      // 8. Non-DOCX: store the bytes and re-point the file. Versions are HTML-only,
      //    so there is deliberately no snapshot here.
      const ext = driveFileName.includes('.') ? driveFileName.split('.').pop() : undefined;
      const fileKey =
        `${orgId}/${projectId}/${opportunityId}/rfp-documents/${documentId}/from-drive/` +
        `${sanitizeFileName(doc.name ?? documentId)}${ext ? `.${ext}` : ''}`;

      await uploadToS3(DOCUMENTS_BUCKET, fileKey, buffer, effectiveMimeType);

      await updateRFPDocumentMetadata({
        projectId,
        opportunityId,
        documentId,
        updates: { fileKey, mimeType: effectiveMimeType, ...driveFields },
        updatedBy: actorUserId,
      });

      await writeDriveSyncAudit({
        orgId,
        documentId,
        action: 'INTEGRATION_SYNC_COMPLETED',
        userId: actorUserId,
        userName: actorName,
        result: 'success',
        changes: { after: { fileKey, driveModifiedTime: remoteModifiedTime } },
      });

      return { changed: true, driveModifiedTime: remoteModifiedTime, driveLastPulledAt };
    }

    // 6. DOCX → HTML, re-hosting images so they survive the next editor save.
    const html = await convertDriveDocxToHtml({
      buffer,
      orgId,
      projectId,
      opportunityId,
      documentId,
    });

    if (!html.trim()) {
      throw new Error('The exported Google Doc converted to empty HTML; nothing was imported.');
    }

    // 7. Version-creating save — the established sequence from revert-version.ts, so
    //    an inbound Drive edit is always recoverable from the version history.
    const changeNote = `Imported from Google Drive (${driveFileName})`;
    const versionNumber = (await getLatestVersionNumber(projectId, opportunityId, documentId)) + 1;
    const htmlContentKey = await saveVersionHtml(
      orgId,
      projectId,
      opportunityId,
      documentId,
      versionNumber,
      html,
    );

    await createVersion({
      versionId: uuidv4(),
      documentId,
      projectId,
      opportunityId,
      orgId,
      versionNumber,
      htmlContentKey,
      title: doc.title ?? doc.name ?? driveFileName,
      documentType: doc.documentType ?? 'OTHER',
      changeNote,
      createdBy: actorUserId,
      createdByName: actorName,
    });

    const liveHtmlKey = await uploadRFPDocumentHtml({
      orgId,
      projectId,
      opportunityId,
      documentId,
      html,
    });

    const editHistory: EditHistoryEntry[] = [
      ...(doc.editHistory ?? []),
      {
        editedBy: actorUserId,
        editedByName: actorName,
        editedAt: driveLastPulledAt,
        action: 'DRIVE_IMPORT' as const,
        changeNote: acceptApprovedOverride
          ? `${changeNote} — approval reopened by ${actorName}`
          : changeNote,
        version: versionNumber,
      },
    ];

    await updateRFPDocumentMetadata({
      projectId,
      opportunityId,
      documentId,
      updates: {
        htmlContentKey: liveHtmlKey,
        editHistory,
        ...driveFields,
        // An override imports content nobody has approved, so the approval must
        // reopen — otherwise the submission gate would still read FULLY_SIGNED.
        ...(acceptApprovedOverride && isApproved
          ? { signatureStatus: 'PENDING_SIGNATURE' as const }
          : {}),
      },
      updatedBy: actorUserId,
    });

    if (acceptApprovedOverride && isApproved) {
      await cancelPendingApprovals(orgId, projectId, opportunityId, documentId).catch(
        (err: unknown) =>
          console.warn(
            `[GoogleDrive] Could not cancel pending approvals: ${(err as Error)?.message}`,
          ),
      );

      const recipientUserIds = await resolveApprovalAudience({
        orgId,
        projectId,
        opportunityId,
        documentId,
        doc,
      });
      if (recipientUserIds.length > 0) {
        await sendNotification(
          buildNotification(
            'DRIVE_EDIT_BLOCKED_APPROVED',
            '⚠️ Approved document reopened',
            `${actorName} imported Google Drive changes into the approved document ` +
              `"${driveFileName}". It now needs approval again.`,
            {
              orgId,
              projectId,
              entityId: `${opportunityId}:${documentId}`,
              recipientUserIds,
              actorDisplayName: actorName,
              link: buildRfpDocumentReviewLink(orgId, projectId, opportunityId, documentId),
            },
          ),
        ).catch((err: unknown) =>
          console.warn(`[GoogleDrive] Override notification failed: ${(err as Error)?.message}`),
        );
      }
    }

    // Tell anyone mid-review that what they are reviewing just changed. Without this
    // they could approve content they never read — the review is still open, so the
    // decision they are about to make now applies to different text.
    if (pendingReviewers.length > 0) {
      await sendNotification(
        buildNotification(
          'DRIVE_EDIT_DURING_REVIEW',
          '📝 Document changed while under review',
          `"${driveFileName}" was edited in Google Drive and imported while it is out ` +
            `for review. Version ${versionNumber} is now the current content — please ` +
            're-check it before approving.',
          {
            orgId,
            projectId,
            entityId: `${opportunityId}:${documentId}`,
            recipientUserIds: pendingReviewers,
            actorDisplayName: actorName,
            link: buildRfpDocumentReviewLink(orgId, projectId, opportunityId, documentId),
          },
        ),
      ).catch((err: unknown) =>
        console.warn(`[GoogleDrive] Review-changed notification failed: ${(err as Error)?.message}`),
      );
    }

    await writeDriveSyncAudit({
      orgId,
      documentId,
      action: 'INTEGRATION_SYNC_COMPLETED',
      userId: actorUserId,
      userName: actorName,
      result: 'success',
      changes: {
        before: { driveModifiedTime: doc.driveModifiedTime ?? null },
        after: { driveModifiedTime: remoteModifiedTime, version: versionNumber },
      },
    });

    return {
      changed: true,
      versionNumber,
      driveModifiedTime: remoteModifiedTime,
      driveLastPulledAt,
      ...(pendingReviewers.length > 0 ? { notifiedPendingReviewers: true } : {}),
      ...(acceptApprovedOverride && isApproved ? { overrodeApproval: true } : {}),
    };
  } catch (err) {
    // The watermark is deliberately untouched, so the next pass retries this edit.
    await markDriveSyncFailed({
      projectId,
      opportunityId,
      documentId,
      message: (err as Error)?.message ?? 'Unknown Google Drive import failure',
    });
    throw err;
  }
};

/** Load the document record for a sync, or `null` when missing/soft-deleted. */
export const loadDriveSyncDocument = async (args: {
  projectId: string;
  opportunityId: string;
  documentId: string;
}): Promise<DriveSyncDocument | null> => {
  const sk = buildDriveSyncSk(args.projectId, args.opportunityId, args.documentId);
  const doc = await getItem<DriveSyncDocument>(RFP_DOCUMENT_PK, sk);
  if (!doc || doc.deletedAt) return null;
  return doc;
};
