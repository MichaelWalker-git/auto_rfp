/**
 * sync-from-google-drive.test.ts
 *
 * The headline cases are the two ways the old pull lost data: it wrote `content.html`
 * directly (so a bad Drive edit was unrecoverable), and it fetched Drive's
 * `modifiedTime` only to discard it (so every pass re-imported and an approved
 * document could be silently overwritten). These tests pin the version snapshot, the
 * change gate, the image re-hosting, and the approved-document block.
 */

jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn() })),
  GetObjectCommand: jest.fn((params) => ({ type: 'GetObject', params })),
  PutObjectCommand: jest.fn((params) => ({ type: 'PutObject', params })),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: jest.fn(() => ({ before: jest.fn() })),
  orgMembershipMiddleware: jest.fn(() => ({ before: jest.fn() })),
  requirePermission: jest.fn(() => ({ before: jest.fn() })),
  httpErrorMiddleware: jest.fn(() => ({ onError: jest.fn() })),
}));

const mockSetAuditContext = jest.fn();
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ before: jest.fn(), after: jest.fn() })),
  setAuditContext: (...args: unknown[]) => mockSetAuditContext(...args),
}));

// ─── DynamoDB access ─────────────────────────────────────────────────────────

const mockGetItem = jest.fn();
const mockUpdateItem = jest.fn();
jest.mock('@/helpers/db', () => ({
  getItem: (...args: unknown[]) => mockGetItem(...args),
  updateItem: (...args: unknown[]) => mockUpdateItem(...args),
  isConditionalCheckFailed: (err: unknown) =>
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: string }).name === 'ConditionalCheckFailedException',
  docClient: { send: jest.fn() },
}));

// ─── Document persistence ────────────────────────────────────────────────────

const mockUpdateMetadata = jest.fn();
const mockUploadHtml = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  updateRFPDocumentMetadata: (...args: unknown[]) => mockUpdateMetadata(...args),
  uploadRFPDocumentHtml: (...args: unknown[]) => mockUploadHtml(...args),
}));

const mockGetLatestVersionNumber = jest.fn();
const mockSaveVersionHtml = jest.fn();
const mockCreateVersion = jest.fn();
jest.mock('@/helpers/rfp-document-version', () => ({
  getLatestVersionNumber: (...args: unknown[]) => mockGetLatestVersionNumber(...args),
  saveVersionHtml: (...args: unknown[]) => mockSaveVersionHtml(...args),
  createVersion: (...args: unknown[]) => mockCreateVersion(...args),
}));

const mockUploadToS3 = jest.fn();
jest.mock('@/helpers/s3', () => ({
  uploadToS3: (...args: unknown[]) => mockUploadToS3(...args),
}));

// ─── Approvals, notifications, audit ─────────────────────────────────────────

const mockListApprovals = jest.fn();
const mockCancelPendingApprovals = jest.fn();
jest.mock('@/helpers/document-approval', () => ({
  listApprovalsByDocument: (...args: unknown[]) => mockListApprovals(...args),
  cancelPendingApprovals: (...args: unknown[]) => mockCancelPendingApprovals(...args),
}));

const mockSendNotification = jest.fn();
jest.mock('@/helpers/send-notification', () => ({
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
  buildNotification: (type: string, title: string, message: string, opts: unknown) => ({
    type,
    title,
    message,
    ...(opts as Record<string, unknown>),
  }),
}));

const mockWriteAuditLog = jest.fn();
jest.mock('@/helpers/audit-log', () => ({
  writeAuditLog: (...args: unknown[]) => mockWriteAuditLog(...args),
}));

jest.mock('@/helpers/secret', () => ({
  getHmacSecret: jest.fn().mockResolvedValue('test-secret'),
}));

// The push half's dependencies are unused here but are imported by the module.
jest.mock('@/helpers/export', () => ({
  loadDocumentHtmlForExport: jest.fn(),
  sanitizeFileName: (name: string) => name.replace(/[^\w\s-]/g, '').replace(/\s+/g, '_'),
}));
jest.mock('@/helpers/export-docx', () => ({
  htmlToDocxBuffer: jest.fn(),
}));

// ─── Google Drive ────────────────────────────────────────────────────────────

const mockFilesGet = jest.fn();
const mockFilesExport = jest.fn();
const mockFilesCreate = jest.fn();
const mockFilesUpdate = jest.fn();
const mockFilesList = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: { JWT: jest.fn(() => ({ authorize: jest.fn().mockResolvedValue(undefined) })) },
    drive: jest.fn(() => ({
      files: {
        get: (...args: unknown[]) => mockFilesGet(...args),
        export: (...args: unknown[]) => mockFilesExport(...args),
        create: (...args: unknown[]) => mockFilesCreate(...args),
        update: (...args: unknown[]) => mockFilesUpdate(...args),
        list: (...args: unknown[]) => mockFilesList(...args),
      },
    })),
  },
}));

jest.mock('@/helpers/api-key-storage', () => ({
  getApiKey: jest.fn().mockResolvedValue(
    JSON.stringify({
      client_email: 'svc@project.iam.gserviceaccount.com',
      private_key: 'key',
      delegate_email: 'owner@example.com',
    }),
  ),
}));

// mammoth is driven per-test so the image converter can be exercised.
const mockConvertToHtml = jest.fn();
const mockImgElement = jest.fn();
jest.mock('mammoth', () => ({
  __esModule: true,
  default: {
    convertToHtml: (...args: unknown[]) => mockConvertToHtml(...args),
    images: { imgElement: (...args: unknown[]) => mockImgElement(...args) },
  },
}));

process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';
process.env['DOCUMENTS_BUCKET'] = 'test-bucket';

import { baseHandler } from './sync-from-google-drive';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import { requirePermission } from '@/middleware/rbac-middleware';
import { DOCX_MIME, GOOGLE_DOC_MIME } from '@/helpers/google-drive-client';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const OPPORTUNITY_ID = '33333333-3333-4333-8333-333333333333';
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '77777777-7777-4777-8777-777777777777';
const REVIEWER_ID = '88888888-8888-4888-8888-888888888888';
const SK = `${PROJECT_ID}#${OPPORTUNITY_ID}#${DOCUMENT_ID}`;

const makeEvent = (overrides: Record<string, unknown> = {}): AuthedEvent =>
  ({
    body: JSON.stringify({
      projectId: PROJECT_ID,
      opportunityId: OPPORTUNITY_ID,
      documentId: DOCUMENT_ID,
      ...overrides,
    }),
    queryStringParameters: { orgId: ORG_ID },
    headers: { 'x-org-id': ORG_ID, 'user-agent': 'test' },
    requestContext: { http: { sourceIp: '127.0.0.1' } },
    auth: {
      userId: USER_ID,
      claims: { 'cognito:username': 'Test User' },
      orgId: ORG_ID,
    },
  }) as unknown as AuthedEvent;

const linkedDocument = {
  partition_key: 'RFP_DOCUMENT',
  sort_key: SK,
  documentId: DOCUMENT_ID,
  projectId: PROJECT_ID,
  opportunityId: OPPORTUNITY_ID,
  orgId: ORG_ID,
  name: 'Technical Proposal',
  title: 'Technical Proposal',
  documentType: 'TECHNICAL_PROPOSAL',
  htmlContentKey: `${ORG_ID}/${PROJECT_ID}/${OPPORTUNITY_ID}/rfp-documents/${DOCUMENT_ID}/content.html`,
  signatureStatus: 'NOT_REQUIRED',
  updatedBy: USER_ID,
  googleDriveFileId: 'file-existing',
  googleDriveUrl: 'https://docs.google.com/document/d/file-existing/edit',
  driveMimeType: GOOGLE_DOC_MIME,
  driveModifiedTime: '2026-08-17T09:00:00.000Z',
  driveLastPushedAt: '2026-08-17T09:00:00.000Z',
};

/** The gate read: Drive metadata including the fields the change gate depends on. */
const driveMeta = (overrides: Record<string, unknown> = {}) => ({
  data: {
    id: 'file-existing',
    name: 'Technical Proposal',
    mimeType: GOOGLE_DOC_MIME,
    modifiedTime: '2026-08-18T11:00:00.000Z',
    trashed: false,
    ...overrides,
  },
});

const parseBody = (result: unknown): Record<string, unknown> =>
  JSON.parse((result as { body: string }).body) as Record<string, unknown>;

/** The metadata write that persists the import (there is only ever one). */
const persistedUpdates = (): Record<string, unknown> | undefined =>
  mockUpdateMetadata.mock.calls[0]?.[0]?.updates as Record<string, unknown> | undefined;

describe('sync-from-google-drive handler', () => {
  beforeEach(() => {
    // Deliberately not jest.clearAllMocks(): `requirePermission` is called once at
    // module load when the middy stack is built, and clearing would erase it.
    for (const mock of [
      mockGetItem,
      mockUpdateItem,
      mockUpdateMetadata,
      mockUploadHtml,
      mockGetLatestVersionNumber,
      mockSaveVersionHtml,
      mockCreateVersion,
      mockUploadToS3,
      mockListApprovals,
      mockCancelPendingApprovals,
      mockSendNotification,
      mockWriteAuditLog,
      mockFilesGet,
      mockFilesExport,
      mockConvertToHtml,
      mockImgElement,
      mockSetAuditContext,
    ]) {
      mock.mockReset();
    }

    mockGetItem.mockResolvedValue(linkedDocument);
    mockUpdateItem.mockResolvedValue({});
    mockUpdateMetadata.mockResolvedValue(linkedDocument);
    mockUploadHtml.mockResolvedValue(linkedDocument.htmlContentKey);
    mockGetLatestVersionNumber.mockResolvedValue(4);
    mockSaveVersionHtml.mockResolvedValue('versions/v5.html');
    mockCreateVersion.mockResolvedValue({});
    mockListApprovals.mockResolvedValue([]);
    mockCancelPendingApprovals.mockResolvedValue(undefined);
    mockSendNotification.mockResolvedValue(undefined);
    mockWriteAuditLog.mockResolvedValue({});
    mockFilesGet.mockResolvedValue(driveMeta());
    mockFilesExport.mockResolvedValue({ data: Buffer.from('PK-docx-bytes') });
    mockConvertToHtml.mockResolvedValue({ value: '<h1>Edited in Drive</h1>' });
    mockImgElement.mockImplementation(() => ({ kind: 'imgElement' }));
  });

  describe('permissions', () => {
    it('requires proposal:edit, not org:edit', () => {
      expect(requirePermission).toHaveBeenCalledWith('proposal:edit');
      expect(requirePermission).not.toHaveBeenCalledWith('org:edit');
    });
  });

  describe('validation', () => {
    it('returns 400 when orgId is missing', async () => {
      const event = {
        ...makeEvent(),
        queryStringParameters: {},
        headers: { 'user-agent': 'test' },
        auth: { userId: USER_ID, claims: {} },
      } as unknown as AuthedEvent;

      expect(await baseHandler(event)).toMatchObject({ statusCode: 400 });
    });

    it('returns 400 when the body is not valid JSON', async () => {
      const event = { ...makeEvent(), body: '{not json' } as unknown as AuthedEvent;
      expect(await baseHandler(event)).toMatchObject({ statusCode: 400 });
    });

    it('returns 400 when documentId is missing', async () => {
      const event = {
        ...makeEvent(),
        body: JSON.stringify({ projectId: PROJECT_ID, opportunityId: OPPORTUNITY_ID }),
      } as unknown as AuthedEvent;

      const result = await baseHandler(event);
      expect(result).toMatchObject({ statusCode: 400 });
      expect(parseBody(result).error).toBe('Invalid request');
    });

    it('returns 404 when the document is soft-deleted', async () => {
      mockGetItem.mockResolvedValue({ ...linkedDocument, deletedAt: '2026-01-01T00:00:00.000Z' });

      expect(await baseHandler(makeEvent())).toMatchObject({ statusCode: 404 });
      expect(mockFilesGet).not.toHaveBeenCalled();
    });

    it('returns 400 DRIVE_NOT_LINKED when the document has never been pushed', async () => {
      mockGetItem.mockResolvedValue({ ...linkedDocument, googleDriveFileId: undefined });

      const result = await baseHandler(makeEvent());
      expect(result).toMatchObject({ statusCode: 400 });
      expect(parseBody(result).code).toBe('DRIVE_NOT_LINKED');
      expect(mockFilesGet).not.toHaveBeenCalled();
    });
  });

  describe('change gate', () => {
    it('does nothing when Drive has not moved since the watermark', async () => {
      mockFilesGet.mockResolvedValue(driveMeta({ modifiedTime: linkedDocument.driveModifiedTime }));

      const result = await baseHandler(makeEvent());

      expect(result).toMatchObject({ statusCode: 200 });
      expect(parseBody(result)).toMatchObject({ changed: false });
      // Zero writes: no claim, no version, no content.
      expect(mockUpdateItem).not.toHaveBeenCalled();
      expect(mockCreateVersion).not.toHaveBeenCalled();
      expect(mockUploadHtml).not.toHaveBeenCalled();
      expect(mockFilesExport).not.toHaveBeenCalled();
    });

    it('treats an older Drive timestamp as unchanged', async () => {
      mockFilesGet.mockResolvedValue(driveMeta({ modifiedTime: '2026-08-01T00:00:00.000Z' }));

      const result = await baseHandler(makeEvent());
      expect(parseBody(result).changed).toBe(false);
      expect(mockCreateVersion).not.toHaveBeenCalled();
    });

    it('imports when the document has no watermark yet', async () => {
      mockGetItem.mockResolvedValue({ ...linkedDocument, driveModifiedTime: undefined });

      const result = await baseHandler(makeEvent());
      expect(parseBody(result).changed).toBe(true);
      expect(mockCreateVersion).toHaveBeenCalledTimes(1);
    });

    it('refuses to import a trashed file without touching content', async () => {
      mockFilesGet.mockResolvedValue(driveMeta({ trashed: true }));

      const result = await baseHandler(makeEvent());

      expect(parseBody(result).changed).toBe(false);
      expect(mockFilesExport).not.toHaveBeenCalled();
      expect(mockUploadHtml).not.toHaveBeenCalled();
      expect(mockCreateVersion).not.toHaveBeenCalled();
      // The failure is recorded so the badge explains itself.
      expect(
        mockUpdateItem.mock.calls.some(
          (call) => (call[2] as Record<string, unknown>).driveSyncStatus === 'SYNC_FAILED',
        ),
      ).toBe(true);
    });
  });

  describe('successful import', () => {
    it('exports the native Doc as DOCX rather than downloading it', async () => {
      await baseHandler(makeEvent());

      expect(mockFilesExport).toHaveBeenCalledTimes(1);
      const [params, options] = mockFilesExport.mock.calls[0] as [
        { fileId: string; mimeType: string },
        { responseType: string },
      ];
      expect(params).toMatchObject({ fileId: 'file-existing', mimeType: DOCX_MIME });
      expect(options.responseType).toBe('arraybuffer');
    });

    it('creates a version snapshot before overwriting live content', async () => {
      const result = await baseHandler(makeEvent());

      expect(result).toMatchObject({ statusCode: 200 });
      expect(parseBody(result)).toMatchObject({ changed: true, versionNumber: 5 });

      expect(mockSaveVersionHtml).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        OPPORTUNITY_ID,
        DOCUMENT_ID,
        5,
        '<h1>Edited in Drive</h1>',
      );
      expect(mockCreateVersion).toHaveBeenCalledWith(
        expect.objectContaining({
          versionNumber: 5,
          htmlContentKey: 'versions/v5.html',
          changeNote: 'Imported from Google Drive (Technical Proposal)',
        }),
      );
      expect(mockUploadHtml).toHaveBeenCalledWith(
        expect.objectContaining({ html: '<h1>Edited in Drive</h1>' }),
      );
    });

    it('appends a DRIVE_IMPORT edit-history entry naming the acting user', async () => {
      await baseHandler(makeEvent());

      const history = persistedUpdates()?.editHistory as Array<Record<string, unknown>>;
      expect(history).toHaveLength(1);
      expect(history[0]).toMatchObject({
        action: 'DRIVE_IMPORT',
        version: 5,
        editedBy: USER_ID,
        editedByName: 'Test User',
      });
    });

    it('advances the watermark to the timestamp from the gate read', async () => {
      await baseHandler(makeEvent());

      expect(persistedUpdates()).toMatchObject({
        driveModifiedTime: '2026-08-18T11:00:00.000Z',
        drivePendingModifiedTime: null,
        driveSyncStatus: 'SYNCED',
        driveSyncError: null,
        driveSyncPk: ORG_ID,
        driveSyncSk: SK,
      });
    });

    it('re-hosts embedded images in S3 instead of inlining data URIs', async () => {
      // Drive an actual image through the converter mammoth would have called.
      mockImgElement.mockImplementation((cb: (image: unknown) => Promise<unknown>) => cb);
      mockConvertToHtml.mockImplementation(
        async (_input: unknown, options: { convertImage: (image: unknown) => Promise<unknown> }) => {
          const attributes = (await options.convertImage({
            contentType: 'image/jpeg',
            readAsBuffer: async () => Buffer.from('jpeg-bytes'),
          })) as { src: string; 'data-s3-key': string };
          return { value: `<img src="${attributes.src}" data-s3-key="${attributes['data-s3-key']}">` };
        },
      );

      await baseHandler(makeEvent());

      const [bucket, key, body, contentType] = mockUploadToS3.mock.calls[0] as [
        string,
        string,
        Buffer,
        string,
      ];
      expect(bucket).toBe('test-bucket');
      expect(key).toMatch(
        new RegExp(
          `^${ORG_ID}/${PROJECT_ID}/${OPPORTUNITY_ID}/rfp-documents/${DOCUMENT_ID}/drive-images/.+\\.jpg$`,
        ),
      );
      expect(body).toEqual(Buffer.from('jpeg-bytes'));
      expect(contentType).toBe('image/jpeg');

      // The stored HTML must reference S3, not carry the bytes — an inline data URI
      // is stripped on the next editor save and the image disappears.
      const [{ html }] = mockUploadHtml.mock.calls[0] as [{ html: string }];
      expect(html).toContain('data-s3-key=');
      expect(html).not.toContain('data:image');
    });

    it('stores a non-DOCX file as a raw download with no version', async () => {
      mockGetItem.mockResolvedValue({ ...linkedDocument, driveMimeType: 'application/pdf' });
      mockFilesGet
        .mockResolvedValueOnce(driveMeta({ mimeType: 'application/pdf', name: 'Scan.pdf' }))
        .mockResolvedValueOnce({ data: Buffer.from('%PDF-1.7') });

      const result = await baseHandler(makeEvent());

      expect(parseBody(result).changed).toBe(true);
      expect(mockFilesExport).not.toHaveBeenCalled();
      // Versions are HTML-only.
      expect(mockCreateVersion).not.toHaveBeenCalled();
      expect(persistedUpdates()).toMatchObject({
        fileKey: expect.stringContaining('/from-drive/'),
        mimeType: 'application/pdf',
      });
    });
  });

  describe('failure handling', () => {
    it('leaves the watermark unchanged when the import throws mid-flight', async () => {
      mockUploadHtml.mockRejectedValue(new Error('S3 unavailable'));

      const result = await baseHandler(makeEvent());

      expect(result).toMatchObject({ statusCode: 500 });
      const failure = mockUpdateItem.mock.calls
        .map((call) => call[2] as Record<string, unknown>)
        .find((updates) => updates.driveSyncStatus === 'SYNC_FAILED');
      expect(failure).toBeDefined();
      // The Drive edit must stay pending so the next pass retries it.
      expect(failure).not.toHaveProperty('driveModifiedTime');
      expect(mockUpdateMetadata).not.toHaveBeenCalled();
    });

    it('returns 409 when another sync already holds the claim', async () => {
      mockUpdateItem.mockRejectedValueOnce(
        Object.assign(new Error('claim taken'), { name: 'ConditionalCheckFailedException' }),
      );

      const result = await baseHandler(makeEvent());

      expect(result).toMatchObject({ statusCode: 409 });
      expect(parseBody(result).code).toBe('DRIVE_SYNC_IN_PROGRESS');
      expect(mockFilesExport).not.toHaveBeenCalled();
      expect(mockCreateVersion).not.toHaveBeenCalled();
    });

    it('refuses an empty conversion rather than blanking the document', async () => {
      mockConvertToHtml.mockResolvedValue({ value: '   ' });

      const result = await baseHandler(makeEvent());

      expect(result).toMatchObject({ statusCode: 500 });
      expect(mockUploadHtml).not.toHaveBeenCalled();
      expect(mockCreateVersion).not.toHaveBeenCalled();
    });
  });

  describe('approved documents', () => {
    const approvedDocument = { ...linkedDocument, signatureStatus: 'FULLY_SIGNED' };

    beforeEach(() => {
      mockGetItem.mockResolvedValue(approvedDocument);
      mockListApprovals.mockResolvedValue([
        {
          approvalId: '99999999-9999-4999-8999-999999999999',
          reviewerId: REVIEWER_ID,
          reviewerEmail: 'reviewer@example.com',
          requestedBy: USER_ID,
          status: 'APPROVED',
        },
      ]);
    });

    it('blocks the import without downloading or writing content', async () => {
      const result = await baseHandler(makeEvent());

      expect(result).toMatchObject({ statusCode: 409 });
      expect(parseBody(result)).toMatchObject({ blocked: true, changed: false });

      // Nothing was fetched, converted, versioned, or saved.
      expect(mockFilesExport).not.toHaveBeenCalled();
      expect(mockConvertToHtml).not.toHaveBeenCalled();
      expect(mockCreateVersion).not.toHaveBeenCalled();
      expect(mockUploadHtml).not.toHaveBeenCalled();
      expect(mockUpdateMetadata).not.toHaveBeenCalled();
    });

    it('records the pending change but leaves the watermark alone', async () => {
      await baseHandler(makeEvent());

      const [, , updates] = mockUpdateItem.mock.calls[0] as [string, string, Record<string, unknown>];
      expect(updates).toMatchObject({
        driveSyncStatus: 'BLOCKED_APPROVED',
        drivePendingModifiedTime: '2026-08-18T11:00:00.000Z',
      });
      // An override must still see the edit as pending.
      expect(updates).not.toHaveProperty('driveModifiedTime');
    });

    it('notifies the approvers and audits the refusal', async () => {
      await baseHandler(makeEvent());

      expect(mockSendNotification).toHaveBeenCalledTimes(1);
      const [notification] = mockSendNotification.mock.calls[0] as [Record<string, unknown>];
      expect(notification).toMatchObject({
        type: 'DRIVE_EDIT_BLOCKED_APPROVED',
        entityId: `${OPPORTUNITY_ID}:${DOCUMENT_ID}`,
      });
      expect(notification.recipientUserIds).toEqual(
        expect.arrayContaining([REVIEWER_ID, USER_ID]),
      );

      const [auditPayload] = mockWriteAuditLog.mock.calls[0] as [Record<string, unknown>];
      expect(auditPayload).toMatchObject({
        action: 'INTEGRATION_SYNC_FAILED',
        resource: 'rfp_document',
        result: 'failure',
      });
    });

    it('does not re-notify for a change it has already alerted on', async () => {
      mockGetItem.mockResolvedValue({
        ...approvedDocument,
        drivePendingModifiedTime: '2026-08-18T11:00:00.000Z',
      });

      await baseHandler(makeEvent());

      expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it('imports and reopens the approval under an explicit override', async () => {
      const result = await baseHandler(makeEvent({ acceptApprovedOverride: true }));

      expect(result).toMatchObject({ statusCode: 200 });
      expect(parseBody(result)).toMatchObject({ changed: true, overrodeApproval: true });

      expect(mockCreateVersion).toHaveBeenCalledTimes(1);
      expect(persistedUpdates()).toMatchObject({ signatureStatus: 'PENDING_SIGNATURE' });
      expect(mockCancelPendingApprovals).toHaveBeenCalledWith(
        ORG_ID,
        PROJECT_ID,
        OPPORTUNITY_ID,
        DOCUMENT_ID,
      );
      expect(mockSendNotification).toHaveBeenCalledTimes(1);
    });

    it('leaves signatureStatus alone when the override flag is set on an unapproved document', async () => {
      mockGetItem.mockResolvedValue(linkedDocument);

      await baseHandler(makeEvent({ acceptApprovedOverride: true }));

      expect(persistedUpdates()).not.toHaveProperty('signatureStatus');
      expect(mockCancelPendingApprovals).not.toHaveBeenCalled();
    });
  });
  describe('documents out for review', () => {
    /**
     * The gap this closes: an import used to land silently while a reviewer had the
     * document open, so they could approve content they never read. It still imports —
     * a pending review is not yet a claim of correctness, and blocking would stall
     * ordinary editing — but the reviewer is told.
     */
    it('imports and notifies the reviewer when a review is open', async () => {
      mockListApprovals.mockResolvedValue([
        {
          approvalId: 'appr-1',
          status: 'PENDING',
          reviewerId: REVIEWER_ID,
          requestedBy: USER_ID,
        },
      ]);

      const result = await baseHandler(makeEvent());

      expect(result).toMatchObject({ statusCode: 200 });
      expect(parseBody(result)).toMatchObject({ changed: true, notifiedPendingReviewers: true });
      // The content really was imported — this is not a block.
      expect(mockCreateVersion).toHaveBeenCalled();

      const notification = mockSendNotification.mock.calls.find(
        ([n]) => (n as { type: string }).type === 'DRIVE_EDIT_DURING_REVIEW',
      );
      expect(notification).toBeDefined();
      expect(notification![0]).toMatchObject({
        recipientUserIds: expect.arrayContaining([REVIEWER_ID, USER_ID]),
      });
    });

    it('does not notify when the only approvals are already decided', async () => {
      mockListApprovals.mockResolvedValue([
        { approvalId: 'appr-1', status: 'APPROVED', reviewerId: REVIEWER_ID, requestedBy: USER_ID },
        { approvalId: 'appr-2', status: 'REJECTED', reviewerId: REVIEWER_ID, requestedBy: USER_ID },
      ]);

      const result = await baseHandler(makeEvent());

      // Nobody is mid-review, so there is nothing to warn about.
      expect(parseBody(result)).not.toHaveProperty('notifiedPendingReviewers');
      expect(
        mockSendNotification.mock.calls.filter(
          ([n]) => (n as { type: string }).type === 'DRIVE_EDIT_DURING_REVIEW',
        ),
      ).toHaveLength(0);
    });

    it('imports normally when no approval has ever been requested', async () => {
      mockListApprovals.mockResolvedValue([]);

      const result = await baseHandler(makeEvent());

      expect(result).toMatchObject({ statusCode: 200 });
      expect(mockSendNotification).not.toHaveBeenCalled();
    });

    it('still imports when the approval lookup fails', async () => {
      mockListApprovals.mockRejectedValue(new Error('DynamoDB unavailable'));

      const result = await baseHandler(makeEvent());

      // A notification is not worth failing an import for.
      expect(result).toMatchObject({ statusCode: 200 });
      expect(parseBody(result)).toMatchObject({ changed: true });
    });
  });
});
