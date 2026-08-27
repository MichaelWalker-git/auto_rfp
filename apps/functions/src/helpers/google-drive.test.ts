/**
 * Tests for the deferred proposal-materials sync (HOR-2729).
 *
 * The "Documents" link in the Linear offer note must be added ONLY AFTER the
 * proposal requirement documents have been generated (reached READY) and
 * uploaded to the Drive /Proposal Materials folder — never at folder-creation
 * time, when the folder would still be empty. These tests exercise that gate
 * on `syncProposalMaterials` directly, injecting a Drive stub so the heavy
 * googleapis/S3 setup is not needed.
 */

// ─── Mock heavy module-level deps before importing the SUT ───
process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.REGION = 'us-east-1';
process.env.APP_URL = 'https://app.test.example';

jest.mock('googleapis', () => ({
  google: { drive: jest.fn(), auth: { JWT: jest.fn() } },
  drive_v3: {},
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({})),
  GetObjectCommand: jest.fn((params) => ({ type: 'GetObject', params })),
}));

const mockSend = jest.fn();
jest.mock('@/helpers/db', () => ({
  docClient: { send: (...a: unknown[]) => mockSend(...a) },
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
}));

jest.mock('@/helpers/date', () => ({ nowIso: () => '2026-08-25T00:00:00.000Z' }));

const mockUpdateLinearDescription = jest.fn();
const mockCreateLinearComment = jest.fn();
jest.mock('@/helpers/linear', () => ({
  updateLinearTicketDescription: (...a: unknown[]) => mockUpdateLinearDescription(...a),
  createLinearComment: (...a: unknown[]) => mockCreateLinearComment(...a),
}));

const mockPushDocumentToDrive = jest.fn();
jest.mock('@/helpers/google-drive-document-sync', () => ({
  pushDocumentToDrive: (...a: unknown[]) => mockPushDocumentToDrive(...a),
}));

const mockGetExecutiveBrief = jest.fn();
jest.mock('@/helpers/executive-opportunity-brief', () => ({
  getExecutiveBrief: (...a: unknown[]) => mockGetExecutiveBrief(...a),
}));

import { syncProposalMaterials } from './google-drive';

// A minimal Drive stub — records every files.create call and returns a fake id/link.
const makeDriveStub = () => {
  const created: Array<Record<string, any>> = [];
  return {
    created,
    files: {
      create: jest.fn(async (params: Record<string, any>) => {
        created.push(params);
        return { data: { id: `file-${created.length}`, webViewLink: `https://docs.google.com/document/d/file-${created.length}` } };
      }),
    },
  };
};

// Build a Query response for loadRFPDocumentsForOpportunity.
const rfpDocsResponse = (items: Array<Record<string, any>>) => ({ Items: items });

const baseArgs = {
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  executiveBriefId: 'proj-1#opp-1',
  proposalFolderId: 'proposal-folder-1',
  rootFolderUrl: 'https://drive.google.com/drive/folders/root-1',
  linearTicketId: 'lin-1',
  analysisDocUrl: 'https://docs.google.com/document/d/analysis-1',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateLinearDescription.mockResolvedValue(true);
  mockPushDocumentToDrive.mockResolvedValue({
    googleDriveFileId: 'file-1',
    googleDriveUrl: 'https://docs.google.com/document/d/file-1',
    updatedExisting: false,
  });
});

describe('syncProposalMaterials — deferred Documents link (HOR-2729)', () => {
  it('uploads READY proposal docs and adds the Documents link with the Analysis link preserved', async () => {
    const drive = makeDriveStub();
    // 1 query (load rfp docs) → 1 READY doc with htmlContentKey.
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type === 'Query') {
        return rfpDocsResponse([
          { documentId: 'doc-1', name: 'Technical Proposal', status: 'READY', htmlContentKey: 'html/doc-1.html' },
        ]);
      }
      return {}; // UpdateCommand (mark doc synced)
    });

    const result = await syncProposalMaterials({ ...baseArgs, drive: drive as any });

    expect(result.uploaded).toBe(1);
    expect(result.documentsLinked).toBe(true);
    // Routed through the idempotent push (records fileId, updates in place).
    expect(mockPushDocumentToDrive).toHaveBeenCalledTimes(1);
    expect(mockPushDocumentToDrive).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc-1',
        folderId: baseArgs.proposalFolderId,
        updatedBy: 'system',
      }),
    );

    // Linear offer note now carries BOTH the Analysis and Documents links.
    const [, , description] = mockUpdateLinearDescription.mock.calls[0];
    expect(description).toContain(`Analysis: ${baseArgs.analysisDocUrl}`);
    expect(description).toContain(`Documents: ${baseArgs.rootFolderUrl}`);
  });

  it('does NOT add the Documents link when there are no READY proposal docs', async () => {
    const drive = makeDriveStub();
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type === 'Query') {
        return rfpDocsResponse([
          { documentId: 'doc-1', name: 'Technical Proposal', status: 'GENERATING', htmlContentKey: undefined },
        ]);
      }
      return {};
    });

    const result = await syncProposalMaterials({ ...baseArgs, drive: drive as any });

    expect(result.uploaded).toBe(0);
    expect(result.documentsLinked).toBe(false);
    expect(mockPushDocumentToDrive).not.toHaveBeenCalled();
    expect(mockUpdateLinearDescription).not.toHaveBeenCalled();
  });

  it('is idempotent — skips docs already on Drive and does not re-upload', async () => {
    const drive = makeDriveStub();
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type === 'Query') {
        return rfpDocsResponse([
          { documentId: 'doc-1', name: 'Technical Proposal', status: 'READY', htmlContentKey: 'html/doc-1.html', googleDriveFileId: 'existing-file' },
        ]);
      }
      return {};
    });

    const result = await syncProposalMaterials({ ...baseArgs, drive: drive as any });

    expect(result.uploaded).toBe(0);
    expect(result.skipped).toBe(1);
    expect(mockPushDocumentToDrive).not.toHaveBeenCalled();
    // Documents link is still ensured (a doc already lives in the folder).
    expect(result.documentsLinked).toBe(true);
  });

  it('no-ops when the opportunity has no Drive folder yet (worker path)', async () => {
    const drive = makeDriveStub();
    // Worker path: only opportunity coords given → loads brief, which has no folder.
    mockGetExecutiveBrief.mockResolvedValue({ projectId: 'proj-1', opportunityId: 'opp-1' });

    const result = await syncProposalMaterials({
      orgId: 'org-1',
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      drive: drive as any,
    });

    expect(result.uploaded).toBe(0);
    expect(result.documentsLinked).toBe(false);
    expect(mockPushDocumentToDrive).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled(); // never even queried for docs
  });

  it('resolves folder + Linear metadata from the brief on the worker path', async () => {
    const drive = makeDriveStub();
    mockGetExecutiveBrief.mockResolvedValue({
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      googleDriveProposalFolderId: 'proposal-folder-1',
      googleDriveFolderUrl: 'https://drive.google.com/drive/folders/root-1',
      googleDriveAnalysisUrl: 'https://docs.google.com/document/d/analysis-1',
      linearTicketId: 'lin-1',
    });
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type === 'Query') {
        return rfpDocsResponse([
          { documentId: 'doc-1', name: 'Compliance Matrix', status: 'READY', htmlContentKey: 'html/doc-1.html' },
        ]);
      }
      return {};
    });

    const result = await syncProposalMaterials({
      orgId: 'org-1',
      projectId: 'proj-1',
      opportunityId: 'opp-1',
      drive: drive as any,
    });

    expect(result.uploaded).toBe(1);
    expect(result.documentsLinked).toBe(true);
    const [, , description] = mockUpdateLinearDescription.mock.calls[0];
    expect(description).toContain('Analysis: https://docs.google.com/document/d/analysis-1');
    expect(description).toContain('Documents: https://drive.google.com/drive/folders/root-1');
  });

  it('falls back to a Linear comment when the description update fails', async () => {
    const drive = makeDriveStub();
    mockUpdateLinearDescription.mockResolvedValue(false);
    mockCreateLinearComment.mockResolvedValue({ id: 'comment-1' });
    mockSend.mockImplementation(async (cmd: any) => {
      if (cmd.type === 'Query') {
        return rfpDocsResponse([
          { documentId: 'doc-1', name: 'Cover Letter', status: 'READY', htmlContentKey: 'html/doc-1.html' },
        ]);
      }
      return {};
    });

    const result = await syncProposalMaterials({ ...baseArgs, drive: drive as any });

    expect(result.documentsLinked).toBe(true);
    expect(mockCreateLinearComment).toHaveBeenCalledTimes(1);
  });
});
