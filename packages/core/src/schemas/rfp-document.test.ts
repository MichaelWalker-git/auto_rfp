import { describe, it, expect } from 'vitest';

import {
  DriveSyncStatusSchema,
  EditHistoryActionSchema,
  RFPDocumentItemSchema,
} from './rfp-document';

/**
 * A document as it exists in DynamoDB today — no Drive attributes at all. Every
 * Drive field is `.nullable().optional()` specifically so records written before
 * this feature still parse; that is what this fixture guards.
 */
const legacyDocument = {
  documentId: 'doc-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  orgId: 'org-1',
  name: 'Technical Proposal',
  documentType: 'TECHNICAL_PROPOSAL',
  mimeType: 'text/html',
  fileSizeBytes: 2048,
  fileKey: null,
  version: 1,
  signatureStatus: 'NOT_REQUIRED',
  linearSyncStatus: 'NOT_SYNCED',
  createdBy: 'user-1',
  updatedBy: 'user-1',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const driveFields = {
  googleDriveFileId: 'file-abc',
  googleDriveUrl: 'https://docs.google.com/document/d/file-abc/edit',
  driveMimeType: 'application/vnd.google-apps.document',
  driveFolderId: 'folder-abc',
  driveModifiedTime: '2026-08-18T10:00:00.000Z',
  drivePendingModifiedTime: null,
  driveLastPushedAt: '2026-08-18T10:00:01.000Z',
  driveLastPulledAt: null,
  driveSyncStatus: 'SYNCED',
  driveSyncError: null,
  driveSyncStartedAt: null,
  driveSyncPk: 'org-1',
  driveSyncSk: 'proj-1#opp-1#doc-1',
};

describe('RFPDocumentItemSchema — Google Drive fields', () => {
  it('still parses a legacy document with no Drive fields', () => {
    const { success, data } = RFPDocumentItemSchema.safeParse(legacyDocument);
    expect(success).toBe(true);
    expect(data?.googleDriveFileId).toBeUndefined();
    expect(data?.driveSyncStatus).toBeUndefined();
  });

  it('accepts a fully linked document', () => {
    const { success, data } = RFPDocumentItemSchema.safeParse({
      ...legacyDocument,
      ...driveFields,
    });
    expect(success).toBe(true);
    expect(data?.driveModifiedTime).toBe('2026-08-18T10:00:00.000Z');
    expect(data?.driveSyncPk).toBe('org-1');
    expect(data?.driveSyncSk).toBe('proj-1#opp-1#doc-1');
  });

  it('accepts explicit nulls on every Drive field', () => {
    const nulled = Object.fromEntries(Object.keys(driveFields).map((key) => [key, null]));
    expect(RFPDocumentItemSchema.safeParse({ ...legacyDocument, ...nulled }).success).toBe(true);
  });

  it('rejects an unknown driveSyncStatus', () => {
    const { success } = RFPDocumentItemSchema.safeParse({
      ...legacyDocument,
      driveSyncStatus: 'PENDING',
    });
    expect(success).toBe(false);
  });
});

describe('DriveSyncStatusSchema', () => {
  it('accepts each status and rejects unknown ones', () => {
    for (const status of ['SYNCED', 'SYNCING', 'SYNC_FAILED', 'BLOCKED_APPROVED']) {
      expect(DriveSyncStatusSchema.safeParse(status).success).toBe(true);
    }
    expect(DriveSyncStatusSchema.safeParse('IN_PROGRESS').success).toBe(false);
  });
});

describe('EditHistoryActionSchema', () => {
  it('includes DRIVE_IMPORT alongside the pre-existing actions', () => {
    for (const action of ['UPLOAD', 'CONVERT', 'CONTENT_EDIT', 'FILE_REPLACE', 'DRIVE_IMPORT']) {
      expect(EditHistoryActionSchema.safeParse(action).success).toBe(true);
    }
  });
});
