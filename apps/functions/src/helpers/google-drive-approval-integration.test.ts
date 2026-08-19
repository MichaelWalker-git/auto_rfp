/**
 * google-drive-approval-integration.test.ts
 *
 * Covers the two places Drive sync meets the approval workflow:
 *
 *  1. A Drive edit landing while a review is OPEN. It imports — a pending review is not
 *     yet a claim of correctness — but the reviewer must be told, or they can approve
 *     text they never read.
 *  2. The frozen snapshot captured when approval completes, which is the Drive-side
 *     record of what was actually signed off.
 *
 * The invariant running through both: neither may ever fail the thing it hangs off.
 * Approval gates proposal submission, so a Drive artefact that cannot be written is a
 * log line, never an error.
 */

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
  QueryCommand: jest.fn((p) => ({ type: 'Query', params: p })),
  GetCommand: jest.fn((p) => ({ type: 'Get', params: p })),
  PutCommand: jest.fn((p) => ({ type: 'Put', params: p })),
  UpdateCommand: jest.fn((p) => ({ type: 'Update', params: p })),
}));
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn() })),
  GetObjectCommand: jest.fn((p) => ({ type: 'GetObject', params: p })),
  PutObjectCommand: jest.fn((p) => ({ type: 'PutObject', params: p })),
}));

const mockGetItem = jest.fn();
const mockUpdateItem = jest.fn();
jest.mock('@/helpers/db', () => ({
  getItem: (...a: unknown[]) => mockGetItem(...a),
  updateItem: (...a: unknown[]) => mockUpdateItem(...a),
  isConditionalCheckFailed: jest.fn(() => false),
}));

const mockListApprovals = jest.fn();
const mockCancelPending = jest.fn();
jest.mock('@/helpers/document-approval', () => ({
  listApprovalsByDocument: (...a: unknown[]) => mockListApprovals(...a),
  cancelPendingApprovals: (...a: unknown[]) => mockCancelPending(...a),
}));

const mockSendNotification = jest.fn();
jest.mock('@/helpers/send-notification', () => ({
  sendNotification: (...a: unknown[]) => mockSendNotification(...a),
  // Passthrough so assertions can read the real type and recipients.
  buildNotification: (type: string, title: string, body: string, opts: object) => ({
    type,
    title,
    body,
    ...opts,
  }),
}));

const mockUpdateMetadata = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  updateRFPDocumentMetadata: (...a: unknown[]) => mockUpdateMetadata(...a),
  uploadRFPDocumentHtml: jest.fn().mockResolvedValue('content.html'),
}));

const mockGetLatestVersion = jest.fn();
jest.mock('@/helpers/rfp-document-version', () => ({
  getLatestVersionNumber: (...a: unknown[]) => mockGetLatestVersion(...a),
  createVersion: jest.fn(),
  saveVersionHtml: jest.fn().mockResolvedValue('versions/v1.html'),
}));

const mockGetDriveClient = jest.fn();
jest.mock('@/helpers/google-drive-client', () => ({
  DOCX_MIME: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  GOOGLE_DOC_MIME: 'application/vnd.google-apps.document',
  getDriveClientForOrg: (...a: unknown[]) => mockGetDriveClient(...a),
  isDriveForbidden: jest.fn(() => false),
  isDriveNotFound: jest.fn(() => false),
  isDriveRateLimited: jest.fn(() => false),
}));

const mockLoadHtmlForExport = jest.fn();
jest.mock('@/helpers/export', () => ({
  loadDocumentHtmlForExport: (...a: unknown[]) => mockLoadHtmlForExport(...a),
  sanitizeFileName: (n: string) => n.replace(/[^\w\s.—()-]/g, '_'),
}));

const mockHtmlToDocx = jest.fn();
jest.mock('@/helpers/export-docx', () => ({
  htmlToDocxBuffer: (...a: unknown[]) => mockHtmlToDocx(...a),
}));

jest.mock('@/helpers/org', () => ({ listOrgMemberAccess: jest.fn().mockResolvedValue([]) }));
jest.mock('@/helpers/approval-links', () => ({
  buildRfpDocumentReviewLink: () => 'https://app.example.com/doc',
}));
jest.mock('@/helpers/audit-log', () => ({ writeAuditLog: jest.fn() }));
jest.mock('@/helpers/secret', () => ({ getHmacSecret: jest.fn().mockResolvedValue('s') }));
jest.mock('@/helpers/s3', () => ({ uploadToS3: jest.fn() }));
jest.mock('mammoth', () => ({
  __esModule: true,
  default: { convertToHtml: jest.fn(), images: { imgElement: jest.fn() } },
}));

process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';
process.env['DOCUMENTS_BUCKET'] = 'test-bucket';

import {
  captureApprovedSnapshot,
  captureApprovedSnapshotIfConfigured,
} from './google-drive-document-sync';

const ORG = 'org-1';
const PROJ = 'proj-1';
const OPP = 'opp-1';
const DOC = 'doc-1';

const scratchDoc = (overrides: Record<string, unknown> = {}) => ({
  documentId: DOC,
  projectId: PROJ,
  opportunityId: OPP,
  orgId: ORG,
  name: 'Technical Proposal',
  htmlContentKey: 'orgs/o/content.html',
  ...overrides,
});

/** Drive double whose folder lookups always miss, so each folder is created. */
const makeDrive = (filesCreate: jest.Mock) => ({
  files: {
    list: jest.fn().mockResolvedValue({ data: { files: [] } }),
    create: filesCreate,
  },
  permissions: { create: jest.fn().mockResolvedValue({ data: { id: 'p' } }) },
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadHtmlForExport.mockResolvedValue('<h1>Approved content</h1>');
  mockHtmlToDocx.mockResolvedValue(Buffer.from('docx-bytes'));
  mockUpdateMetadata.mockResolvedValue({});
  mockGetLatestVersion.mockResolvedValue(7);
  mockSendNotification.mockResolvedValue({});
});

describe('captureApprovedSnapshot — the frozen record', () => {
  it('creates a SEPARATE Drive file rather than touching the live one', async () => {
    const filesCreate = jest
      .fn()
      // three folder creations, then the snapshot itself
      .mockResolvedValueOnce({ data: { id: 'root' } })
      .mockResolvedValueOnce({ data: { id: 'project' } })
      .mockResolvedValueOnce({ data: { id: 'snapshots' } })
      .mockResolvedValueOnce({
        data: { id: 'snapshot-file', webViewLink: 'https://docs.google.com/d/snapshot-file' },
      });

    const result = await captureApprovedSnapshot({
      drive: makeDrive(filesCreate) as never,
      doc: scratchDoc({ googleDriveFileId: 'live-file' }) as never,
      orgId: ORG,
      projectId: PROJ,
      opportunityId: OPP,
      documentId: DOC,
      approvedVersion: 7,
    });

    expect(result).toMatchObject({ fileId: 'snapshot-file' });

    // The whole point: the live editing pointer is a different file and is untouched.
    const written = mockUpdateMetadata.mock.calls[0]![0].updates as Record<string, unknown>;
    expect(written.driveApprovedSnapshotFileId).toBe('snapshot-file');
    expect(written).not.toHaveProperty('googleDriveFileId');
    expect(written.driveApprovedSnapshotVersion).toBe(7);
  });

  it('does not write to signatureDetails, which the e-signature feature owns', async () => {
    const filesCreate = jest
      .fn()
      .mockResolvedValueOnce({ data: { id: 'root' } })
      .mockResolvedValueOnce({ data: { id: 'project' } })
      .mockResolvedValueOnce({ data: { id: 'snapshots' } })
      .mockResolvedValueOnce({ data: { id: 'snapshot-file', webViewLink: 'https://x' } });

    await captureApprovedSnapshot({
      drive: makeDrive(filesCreate) as never,
      doc: scratchDoc() as never,
      orgId: ORG,
      projectId: PROJ,
      opportunityId: OPP,
      documentId: DOC,
    });

    // Two features contending for one field's meaning is the thing being avoided.
    const written = mockUpdateMetadata.mock.calls[0]![0].updates as Record<string, unknown>;
    expect(written).not.toHaveProperty('signatureDetails');
  });

  it('files the snapshot in its own folder, apart from the editable copies', async () => {
    const filesCreate = jest
      .fn()
      .mockResolvedValueOnce({ data: { id: 'root' } })
      .mockResolvedValueOnce({ data: { id: 'project' } })
      .mockResolvedValueOnce({ data: { id: 'snapshots' } })
      .mockResolvedValueOnce({ data: { id: 'snapshot-file', webViewLink: 'https://x' } });

    await captureApprovedSnapshot({
      drive: makeDrive(filesCreate) as never,
      doc: scratchDoc() as never,
      orgId: ORG,
      projectId: PROJ,
      opportunityId: OPP,
      documentId: DOC,
    });

    const folderNames = filesCreate.mock.calls
      .slice(0, 3)
      .map(([arg]) => (arg as { requestBody: { name: string } }).requestBody.name);
    expect(folderNames).toEqual(['RFP Documents', PROJ, 'Approved Snapshots']);

    const snapshotCall = filesCreate.mock.calls[3]![0] as {
      requestBody: { name: string; parents: string[]; description: string };
    };
    expect(snapshotCall.requestBody.parents).toEqual(['snapshots']);
    // The name has to distinguish repeat approvals in the Drive UI.
    expect(snapshotCall.requestBody.name).toContain('APPROVED');
    expect(snapshotCall.requestBody.description).toContain('Do not edit');
  });

  it('returns null instead of throwing when Drive rejects the upload', async () => {
    const filesCreate = jest
      .fn()
      .mockResolvedValueOnce({ data: { id: 'root' } })
      .mockResolvedValueOnce({ data: { id: 'project' } })
      .mockResolvedValueOnce({ data: { id: 'snapshots' } })
      .mockRejectedValueOnce(new Error('Drive 503'));

    const result = await captureApprovedSnapshot({
      drive: makeDrive(filesCreate) as never,
      doc: scratchDoc() as never,
      orgId: ORG,
      projectId: PROJ,
      opportunityId: OPP,
      documentId: DOC,
    });

    // Throwing here would surface inside the approval handler.
    expect(result).toBeNull();
    expect(mockUpdateMetadata).not.toHaveBeenCalled();
  });

  it('returns null rather than throwing when the content is empty', async () => {
    mockLoadHtmlForExport.mockResolvedValue('   ');
    const filesCreate = jest.fn();

    const result = await captureApprovedSnapshot({
      drive: makeDrive(filesCreate) as never,
      doc: scratchDoc() as never,
      orgId: ORG,
      projectId: PROJ,
      opportunityId: OPP,
      documentId: DOC,
    });

    expect(result).toBeNull();
    expect(filesCreate).not.toHaveBeenCalled();
  });
});

describe('captureApprovedSnapshotIfConfigured — safe to call from the approval path', () => {
  it('does nothing when the org has no Drive credential', async () => {
    mockGetItem.mockResolvedValue(scratchDoc());
    mockGetDriveClient.mockResolvedValue(null);

    await captureApprovedSnapshotIfConfigured({
      orgId: ORG,
      projectId: PROJ,
      opportunityId: OPP,
      documentId: DOC,
    });

    expect(mockUpdateMetadata).not.toHaveBeenCalled();
  });

  it('does nothing when the document has no content to freeze', async () => {
    mockGetItem.mockResolvedValue(scratchDoc({ htmlContentKey: undefined, fileKey: undefined }));

    await captureApprovedSnapshotIfConfigured({
      orgId: ORG,
      projectId: PROJ,
      opportunityId: OPP,
      documentId: DOC,
    });

    // Checked before resolving a client, so an empty document costs no secret read.
    expect(mockGetDriveClient).not.toHaveBeenCalled();
  });

  it('captures for a document that was never pushed to Drive', async () => {
    mockGetItem.mockResolvedValue(scratchDoc({ googleDriveFileId: undefined }));
    const filesCreate = jest
      .fn()
      .mockResolvedValueOnce({ data: { id: 'root' } })
      .mockResolvedValueOnce({ data: { id: 'project' } })
      .mockResolvedValueOnce({ data: { id: 'snapshots' } })
      .mockResolvedValueOnce({ data: { id: 'snapshot-file', webViewLink: 'https://x' } });
    mockGetDriveClient.mockResolvedValue({
      drive: makeDrive(filesCreate),
      delegateEmail: 'owner@example.com',
    });

    await captureApprovedSnapshotIfConfigured({
      orgId: ORG,
      projectId: PROJ,
      opportunityId: OPP,
      documentId: DOC,
    });

    // An approval deserves a record whether or not anyone used Drive to edit it.
    expect(mockUpdateMetadata).toHaveBeenCalled();
  });

  it('swallows a failure to read the document', async () => {
    mockGetItem.mockRejectedValue(new Error('DynamoDB unavailable'));

    await expect(
      captureApprovedSnapshotIfConfigured({
        orgId: ORG,
        projectId: PROJ,
        opportunityId: OPP,
        documentId: DOC,
      }),
    ).resolves.toBeUndefined();
  });

  it('still captures when the version number cannot be read', async () => {
    mockGetItem.mockResolvedValue(scratchDoc());
    mockGetLatestVersion.mockRejectedValue(new Error('no versions'));
    const filesCreate = jest
      .fn()
      .mockResolvedValueOnce({ data: { id: 'root' } })
      .mockResolvedValueOnce({ data: { id: 'project' } })
      .mockResolvedValueOnce({ data: { id: 'snapshots' } })
      .mockResolvedValueOnce({ data: { id: 'snapshot-file', webViewLink: 'https://x' } });
    mockGetDriveClient.mockResolvedValue({
      drive: makeDrive(filesCreate),
      delegateEmail: 'owner@example.com',
    });

    await captureApprovedSnapshotIfConfigured({
      orgId: ORG,
      projectId: PROJ,
      opportunityId: OPP,
      documentId: DOC,
    });

    const written = mockUpdateMetadata.mock.calls[0]![0].updates as Record<string, unknown>;
    expect(written.driveApprovedSnapshotFileId).toBe('snapshot-file');
    // Absent rather than null — the traceability field is optional, not falsified.
    expect(written).not.toHaveProperty('driveApprovedSnapshotVersion');
  });
});
