/**
 * sync-to-google-drive.test.ts
 *
 * The headline case is the duplicate-file regression: the handler used to call
 * `drive.files.create` unconditionally, so every re-sync left another orphaned
 * copy in the Drive folder and re-pointed the document at the newest one. These
 * tests pin the create-vs-update decision, including the two failure modes where
 * getting it wrong silently produces duplicates (404 vs 403).
 */

// Mock middy before importing handlers
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

jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ before: jest.fn(), after: jest.fn() })),
  setAuditContext: jest.fn(),
}));

// ─── DynamoDB access ─────────────────────────────────────────────────────────

const mockGetItem = jest.fn();
const mockUpdateItem = jest.fn();
jest.mock('@/helpers/db', () => ({
  getItem: (...args: unknown[]) => mockGetItem(...args),
  updateItem: (...args: unknown[]) => mockUpdateItem(...args),
  isConditionalCheckFailed: (err: unknown) =>
    typeof err === 'object' && err !== null &&
    (err as { name?: string }).name === 'ConditionalCheckFailedException',
  docClient: { send: jest.fn() },
}));

// ─── Document export (HTML → DOCX) ───────────────────────────────────────────

const mockLoadHtml = jest.fn();
jest.mock('@/helpers/export', () => ({
  loadDocumentHtmlForExport: (...args: unknown[]) => mockLoadHtml(...args),
  sanitizeFileName: (name: string) => name.replace(/[^\w\s-]/g, ''),
}));

const mockHtmlToDocxBuffer = jest.fn();
jest.mock('@/helpers/export-docx', () => ({
  htmlToDocxBuffer: (...args: unknown[]) => mockHtmlToDocxBuffer(...args),
}));

// ─── Google Drive ────────────────────────────────────────────────────────────
// The real `google-drive-client` is exercised here (its JWT bootstrap is covered
// by its own test); only `googleapis` itself and the secret read are faked, so the
// create-vs-update decision runs against genuine error classification.

const mockFilesCreate = jest.fn();
const mockFilesUpdate = jest.fn();
const mockFilesGet = jest.fn();
const mockFilesList = jest.fn();

jest.mock('googleapis', () => ({
  google: {
    auth: { JWT: jest.fn(() => ({ authorize: jest.fn().mockResolvedValue(undefined) })) },
    drive: jest.fn(() => ({
      files: {
        create: (...args: unknown[]) => mockFilesCreate(...args),
        update: (...args: unknown[]) => mockFilesUpdate(...args),
        get: (...args: unknown[]) => mockFilesGet(...args),
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

process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';
process.env['DOCUMENTS_BUCKET'] = 'test-bucket';

import { baseHandler } from './sync-to-google-drive';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import { requirePermission } from '@/middleware/rbac-middleware';
import { GOOGLE_DOC_MIME, DOCX_MIME } from '@/helpers/google-drive-client';

const ORG_ID = '11111111-1111-4111-8111-111111111111';
const PROJECT_ID = '22222222-2222-4222-8222-222222222222';
const OPPORTUNITY_ID = '33333333-3333-4333-8333-333333333333';
const DOCUMENT_ID = '44444444-4444-4444-8444-444444444444';
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
      userId: '77777777-7777-4777-8777-777777777777',
      userName: 'Test User',
      claims: {},
      orgId: ORG_ID,
    },
  } as unknown as AuthedEvent);

const baseDocument = {
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
  // The old push overwrote these with its generated export DOCX.
  fileKey: 'original/uploaded.pdf',
  mimeType: 'application/pdf',
  driveFolderId: 'folder-abc',
};

/** The Drive response shape the watermark is read from. */
const driveFile = (id: string, modifiedTime: string) => ({
  data: {
    id,
    name: 'Technical Proposal',
    webViewLink: `https://docs.google.com/document/d/${id}/edit`,
    modifiedTime,
    mimeType: GOOGLE_DOC_MIME,
  },
});

/** A GaxiosError-shaped failure. */
const driveError = (status: number): Error & { code: number } =>
  Object.assign(new Error(`Drive ${status}`), { code: status });

/** The `updateItem` call that persists the push result (as opposed to the claim). */
const findPersistCall = (): Record<string, unknown> | undefined =>
  mockUpdateItem.mock.calls
    .map((call) => call[2] as Record<string, unknown>)
    .find((updates) => 'googleDriveFileId' in updates);

describe('sync-to-google-drive handler', () => {
  beforeEach(() => {
    // Deliberately not jest.clearAllMocks(): `requirePermission` is called once at
    // module load when the middy stack is built, and clearing would erase it.
    mockGetItem.mockReset();
    mockUpdateItem.mockReset();
    mockFilesCreate.mockReset();
    mockFilesUpdate.mockReset();
    mockFilesGet.mockReset();
    mockFilesList.mockReset();
    mockLoadHtml.mockReset();
    mockHtmlToDocxBuffer.mockReset();

    mockUpdateItem.mockResolvedValue({});
    mockLoadHtml.mockResolvedValue('<h1>Proposal</h1><ol><li>One</li></ol>');
    mockHtmlToDocxBuffer.mockResolvedValue(Buffer.from('PK-docx-bytes'));
  });

  describe('permissions', () => {
    it('requires proposal:edit, not org:edit', () => {
      expect(requirePermission).toHaveBeenCalledWith('proposal:edit');
      expect(requirePermission).not.toHaveBeenCalledWith('org:edit');
    });
  });

  describe('validation', () => {
    it('returns 400 when orgId is missing', async () => {
      const event = makeEvent();
      const stripped = {
        ...event,
        queryStringParameters: {},
        headers: { 'user-agent': 'test' },
        auth: { userId: 'u1', claims: {} },
      } as unknown as AuthedEvent;

      const result = await baseHandler(stripped);
      expect(result).toMatchObject({ statusCode: 400 });
      expect(JSON.parse((result as { body: string }).body).message).toContain('orgId');
    });

    it('returns 400 when the body is not valid JSON', async () => {
      const event = { ...makeEvent(), body: '{not json' } as unknown as AuthedEvent;
      const result = await baseHandler(event);
      expect(result).toMatchObject({ statusCode: 400 });
    });

    it('returns 400 when documentId is missing', async () => {
      const event = {
        ...makeEvent(),
        body: JSON.stringify({ projectId: PROJECT_ID, opportunityId: OPPORTUNITY_ID }),
      } as unknown as AuthedEvent;

      const result = await baseHandler(event);
      expect(result).toMatchObject({ statusCode: 400 });
      expect(JSON.parse((result as { body: string }).body).error).toBe('Invalid request');
    });

    it('returns 404 when the document is soft-deleted', async () => {
      mockGetItem.mockResolvedValue({ ...baseDocument, deletedAt: '2026-01-01T00:00:00.000Z' });

      const result = await baseHandler(makeEvent());
      expect(result).toMatchObject({ statusCode: 404 });
      expect(mockFilesCreate).not.toHaveBeenCalled();
      expect(mockFilesUpdate).not.toHaveBeenCalled();
    });
  });

  describe('first sync — unlinked document', () => {
    it('creates a native Google Doc and never calls files.update', async () => {
      mockGetItem.mockResolvedValue(baseDocument);
      mockFilesCreate.mockResolvedValue(driveFile('file-new', '2026-08-18T10:00:00.000Z'));

      const result = await baseHandler(makeEvent());

      expect(result).toMatchObject({ statusCode: 200 });
      expect(mockFilesUpdate).not.toHaveBeenCalled();
      expect(mockFilesCreate).toHaveBeenCalledTimes(1);

      const createArgs = mockFilesCreate.mock.calls[0]![0] as {
        requestBody: { name: string; parents: string[]; mimeType?: string };
        media: { mimeType: string };
        fields: string;
      };
      // requestBody.mimeType is the *target* type — this is what makes Drive convert
      // the DOCX upload into a collaboratively editable Doc rather than storing a binary.
      expect(createArgs.requestBody.mimeType).toBe(GOOGLE_DOC_MIME);
      expect(createArgs.media.mimeType).toBe(DOCX_MIME);
      expect(createArgs.requestBody.parents).toEqual(['folder-abc']);
      expect(createArgs.fields).toContain('modifiedTime');

      const body = JSON.parse((result as { body: string }).body);
      expect(body).toMatchObject({
        documentId: DOCUMENT_ID,
        googleDriveFileId: 'file-new',
        updatedExisting: false,
        syncStatus: 'SYNCED',
      });
    });

    it('reuses the cached driveFolderId instead of re-walking the folder tree', async () => {
      mockGetItem.mockResolvedValue(baseDocument);
      mockFilesCreate.mockResolvedValue(driveFile('file-new', '2026-08-18T10:00:00.000Z'));

      await baseHandler(makeEvent());

      expect(mockFilesList).not.toHaveBeenCalled();
    });
  });

  describe('re-sync — linked document', () => {
    const linkedDocument = {
      ...baseDocument,
      googleDriveFileId: 'file-existing',
      googleDriveUrl: 'https://docs.google.com/document/d/file-existing/edit',
      driveModifiedTime: '2026-08-17T09:00:00.000Z',
      driveLastPushedAt: '2026-08-17T09:00:00.000Z',
    };

    it('updates the existing file in place and never creates a duplicate', async () => {
      mockGetItem.mockResolvedValue(linkedDocument);
      mockFilesUpdate.mockResolvedValue(driveFile('file-existing', '2026-08-18T11:00:00.000Z'));

      const result = await baseHandler(makeEvent());

      expect(result).toMatchObject({ statusCode: 200 });
      // The regression: any files.create here is a duplicate Drive file.
      expect(mockFilesCreate).not.toHaveBeenCalled();
      expect(mockFilesUpdate).toHaveBeenCalledTimes(1);

      const updateArgs = mockFilesUpdate.mock.calls[0]![0] as {
        fileId: string;
        requestBody: Record<string, unknown>;
      };
      expect(updateArgs.fileId).toBe('file-existing');
      // `parents` in files.update's requestBody is a 400 — moving uses addParents.
      expect(updateArgs.requestBody).not.toHaveProperty('parents');

      const body = JSON.parse((result as { body: string }).body);
      expect(body.updatedExisting).toBe(true);
      expect(body.message).toBe('Google Doc updated');
    });

    it('takes the watermark from the mutation response, with no follow-up files.get', async () => {
      mockGetItem.mockResolvedValue(linkedDocument);
      mockFilesUpdate.mockResolvedValue(driveFile('file-existing', '2026-08-18T11:00:00.000Z'));

      await baseHandler(makeEvent());

      // A follow-up read could capture a collaborator's newer timestamp as our
      // watermark, and their edit would then never be pulled.
      expect(mockFilesGet).not.toHaveBeenCalled();

      const persisted = findPersistCall();
      expect(persisted?.driveModifiedTime).toBe('2026-08-18T11:00:00.000Z');
    });

    it('leaves fileKey and mimeType alone', async () => {
      mockGetItem.mockResolvedValue(linkedDocument);
      mockFilesUpdate.mockResolvedValue(driveFile('file-existing', '2026-08-18T11:00:00.000Z'));

      await baseHandler(makeEvent());

      for (const call of mockUpdateItem.mock.calls) {
        const updates = call[2] as Record<string, unknown>;
        expect(updates).not.toHaveProperty('fileKey');
        expect(updates).not.toHaveProperty('mimeType');
      }
    });

    it('writes the sparse GSI keys and clears the previous error', async () => {
      mockGetItem.mockResolvedValue({ ...linkedDocument, driveSyncError: 'previous failure' });
      mockFilesUpdate.mockResolvedValue(driveFile('file-existing', '2026-08-18T11:00:00.000Z'));

      await baseHandler(makeEvent());

      expect(findPersistCall()).toMatchObject({
        driveSyncPk: ORG_ID,
        driveSyncSk: SK,
        driveSyncStatus: 'SYNCED',
        driveSyncError: null,
      });
    });
  });

  describe('Drive failures', () => {
    const linkedDocument = { ...baseDocument, googleDriveFileId: 'file-existing' };

    it('recreates exactly once when the linked file is genuinely gone (404)', async () => {
      mockGetItem.mockResolvedValue(linkedDocument);
      mockFilesUpdate.mockRejectedValue(driveError(404));
      mockFilesCreate.mockResolvedValue(driveFile('file-recreated', '2026-08-18T12:00:00.000Z'));

      const result = await baseHandler(makeEvent());

      expect(result).toMatchObject({ statusCode: 200 });
      expect(mockFilesCreate).toHaveBeenCalledTimes(1);
      expect(findPersistCall()?.googleDriveFileId).toBe('file-recreated');
    });

    it('never recreates on 403 — that is how duplicates appear', async () => {
      mockGetItem.mockResolvedValue(linkedDocument);
      mockFilesUpdate.mockRejectedValue(driveError(403));

      const result = await baseHandler(makeEvent());

      expect(result).toMatchObject({ statusCode: 500 });
      expect(mockFilesCreate).not.toHaveBeenCalled();

      const failure = mockUpdateItem.mock.calls
        .map((call) => call[2] as Record<string, unknown>)
        .find((updates) => updates.driveSyncStatus === 'SYNC_FAILED');
      expect(failure).toBeDefined();
      expect(failure?.driveSyncError).toContain('403');
      // The watermark must survive a failure so the next pass retries.
      expect(failure).not.toHaveProperty('driveModifiedTime');
    });

    it('records SYNC_FAILED when Drive omits modifiedTime', async () => {
      mockGetItem.mockResolvedValue(baseDocument);
      mockFilesCreate.mockResolvedValue({ data: { id: 'file-new' } });

      const result = await baseHandler(makeEvent());

      expect(result).toMatchObject({ statusCode: 500 });
      expect(
        mockUpdateItem.mock.calls.some(
          (call) => (call[2] as Record<string, unknown>).driveSyncStatus === 'SYNC_FAILED',
        ),
      ).toBe(true);
    });

    it('returns 409 when another sync already holds the claim', async () => {
      mockGetItem.mockResolvedValue(baseDocument);
      mockUpdateItem.mockRejectedValueOnce(
        Object.assign(new Error('claim taken'), { name: 'ConditionalCheckFailedException' }),
      );

      const result = await baseHandler(makeEvent());

      expect(result).toMatchObject({ statusCode: 409 });
      expect(JSON.parse((result as { body: string }).body).code).toBe('DRIVE_SYNC_IN_PROGRESS');
      expect(mockFilesCreate).not.toHaveBeenCalled();
      expect(mockFilesUpdate).not.toHaveBeenCalled();
    });
  });
});
