// --- Mocks MUST come before imports ---

jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => {
    const wrapped = (...args: unknown[]) => (handler as (...args: unknown[]) => unknown)(...args);
    wrapped.use = jest.fn().mockReturnValue(wrapped);
    return wrapped;
  };
  return { __esModule: true, default: middy };
});

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  GetCommand: jest.fn((params: unknown) => ({ type: 'Get', params })),
}));

jest.mock('@/helpers/s3', () => ({
  loadTextFromS3: jest.fn(),
  getFileFromS3: jest.fn(),
}));

const mockImportAttachments = jest.fn();
const mockFilterDocumentLinks = jest.fn();
const mockDetectAttachmentLinks = jest.fn();
jest.mock('@/helpers/attachment-importer', () => ({
  detectAttachmentLinks: mockDetectAttachmentLinks,
  filterDocumentLinks: mockFilterDocumentLinks,
  importAttachments: mockImportAttachments,
  extractFilenameFromUrl: jest.fn((url: string) => 'attachment.pdf'),
}));

jest.mock('@/helpers/pdf-hyperlinks', () => ({
  extractPdfHyperlinks: jest.fn(() => []),
}));

jest.mock('@/helpers/audit-log', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/helpers/secret', () => ({
  getHmacSecret: jest.fn().mockResolvedValue('mock-secret'),
}));

// Set environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.REGION = 'us-east-1';

import { handler } from './detect-and-import-attachments';
import { loadTextFromS3 } from '@/helpers/s3';
import { MAX_LINK_DEPTH } from '@/constants/attachment';

const mockLoadTextFromS3 = loadTextFromS3 as jest.MockedFunction<typeof loadTextFromS3>;

describe('detect-and-import-attachments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockDetectAttachmentLinks.mockReturnValue([]);
    mockFilterDocumentLinks.mockResolvedValue([]);
    mockImportAttachments.mockResolvedValue([]);
  });

  const baseInput = {
    questionFileId: 'qf-123',
    projectId: 'proj-456',
    oppId: 'opp-789',
    textFileKey: 'text/file.txt',
  };

  const mockParentFile = {
    questionFileId: 'qf-123',
    projectId: 'proj-456',
    oppId: 'opp-789',
    orgId: 'org-111',
    fileKey: 'files/document.pdf',
    textFileKey: 'text/file.txt',
    originalFileName: 'RFP Document.pdf',
    mimeType: 'application/pdf',
    status: 'PROCESSED',
    depth: 0,
  };

  // ─── Missing Parent File ───────────────────────────────────────────────────────

  describe('missing parent file', () => {
    it('returns error when parent question file not found', async () => {
      mockSend.mockResolvedValue({ Item: undefined });

      const result = await handler(baseInput);

      expect(result.errors).toContain('Parent question file not found');
      expect(result.importedAttachments).toBe(0);
      expect(result.detectedLinks).toBe(0);
    });
  });

  // ─── Depth Cutoff ──────────────────────────────────────────────────────────────

  describe('depth cutoff', () => {
    it('skips processing when depth equals MAX_LINK_DEPTH', async () => {
      mockSend.mockResolvedValue({
        Item: { ...mockParentFile, depth: MAX_LINK_DEPTH },
      });

      const result = await handler(baseInput);

      expect(result.errors).toHaveLength(0);
      expect(result.importedAttachments).toBe(0);
      expect(mockDetectAttachmentLinks).not.toHaveBeenCalled();
    });

    it('skips processing when depth exceeds MAX_LINK_DEPTH', async () => {
      mockSend.mockResolvedValue({
        Item: { ...mockParentFile, depth: MAX_LINK_DEPTH + 1 },
      });

      const result = await handler(baseInput);

      expect(result.errors).toHaveLength(0);
      expect(result.importedAttachments).toBe(0);
    });

    it('processes when depth is below MAX_LINK_DEPTH', async () => {
      mockSend.mockResolvedValue({
        Item: { ...mockParentFile, depth: MAX_LINK_DEPTH - 1 },
      });
      mockLoadTextFromS3.mockResolvedValue('Some text without links');

      const result = await handler(baseInput);

      expect(mockDetectAttachmentLinks).toHaveBeenCalled();
    });
  });

  // ─── Missing/Empty Text ────────────────────────────────────────────────────────

  describe('missing/empty text', () => {
    it('returns error when no text file key available', async () => {
      mockSend.mockResolvedValue({
        Item: { ...mockParentFile, textFileKey: undefined },
      });

      const result = await handler({
        ...baseInput,
        textFileKey: undefined,
      });

      expect(result.errors).toContain('No text file key available');
    });

    it('returns early when extracted text is empty', async () => {
      mockSend.mockResolvedValue({ Item: mockParentFile });
      mockLoadTextFromS3.mockResolvedValue('');

      const result = await handler(baseInput);

      expect(result.importedAttachments).toBe(0);
      expect(mockDetectAttachmentLinks).not.toHaveBeenCalled();
    });

    it('returns early when extracted text is only whitespace', async () => {
      mockSend.mockResolvedValue({ Item: mockParentFile });
      mockLoadTextFromS3.mockResolvedValue('   \n\t  ');

      const result = await handler(baseInput);

      expect(result.importedAttachments).toBe(0);
    });

    it('returns error when S3 load fails', async () => {
      mockSend.mockResolvedValue({ Item: mockParentFile });
      mockLoadTextFromS3.mockRejectedValue(new Error('S3 access denied'));

      const result = await handler(baseInput);

      expect(result.errors).toContain('Failed to load text: S3 access denied');
    });
  });

  // ─── Link Detection + Dedupe ───────────────────────────────────────────────────

  describe('link detection + dedupe', () => {
    it('detects links from extracted text', async () => {
      mockSend.mockResolvedValue({ Item: mockParentFile });
      mockLoadTextFromS3.mockResolvedValue('Download from https://sam.gov/file.pdf');
      mockDetectAttachmentLinks.mockReturnValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
      ]);
      mockFilterDocumentLinks.mockResolvedValue([]);

      await handler(baseInput);

      expect(mockDetectAttachmentLinks).toHaveBeenCalledWith('Download from https://sam.gov/file.pdf');
    });

    it('returns early when no candidate links found', async () => {
      mockSend.mockResolvedValue({ Item: mockParentFile });
      mockLoadTextFromS3.mockResolvedValue('No links here');
      mockDetectAttachmentLinks.mockReturnValue([]);

      const result = await handler(baseInput);

      expect(result.detectedLinks).toBe(0);
      expect(mockFilterDocumentLinks).not.toHaveBeenCalled();
    });

    it('filters duplicate URLs', async () => {
      mockSend.mockResolvedValue({ Item: mockParentFile });
      mockLoadTextFromS3.mockResolvedValue('Text with links');
      mockDetectAttachmentLinks.mockReturnValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
        { url: 'https://SAM.GOV/file.pdf', filename: 'file.pdf' }, // Same URL, different case
        { url: 'https://other.gov/doc.pdf', filename: 'doc.pdf' },
      ]);
      mockFilterDocumentLinks.mockResolvedValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
        { url: 'https://other.gov/doc.pdf', filename: 'doc.pdf' },
      ]);

      const result = await handler(baseInput);

      expect(result.detectedLinks).toBe(2);
    });
  });

  // ─── Filtering Behavior ────────────────────────────────────────────────────────

  describe('filtering behavior', () => {
    it('filters links via HEAD request and reports count', async () => {
      mockSend.mockResolvedValue({ Item: mockParentFile });
      mockLoadTextFromS3.mockResolvedValue('Text with links');
      mockDetectAttachmentLinks.mockReturnValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
        { url: 'https://sam.gov/page.html', filename: 'page.html' },
      ]);
      mockFilterDocumentLinks.mockResolvedValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
      ]);

      const result = await handler(baseInput);

      expect(result.detectedLinks).toBe(1);
      expect(mockFilterDocumentLinks).toHaveBeenCalled();
    });

    it('returns early when no processable links after filtering', async () => {
      mockSend.mockResolvedValue({ Item: mockParentFile });
      mockLoadTextFromS3.mockResolvedValue('Text with links');
      mockDetectAttachmentLinks.mockReturnValue([
        { url: 'https://sam.gov/page.html', filename: 'page.html' },
      ]);
      mockFilterDocumentLinks.mockResolvedValue([]);

      const result = await handler(baseInput);

      expect(result.detectedLinks).toBe(0);
      expect(mockImportAttachments).not.toHaveBeenCalled();
    });
  });

  // ─── Import Invocation ─────────────────────────────────────────────────────────

  describe('import invocation', () => {
    it('invokes importAttachments with correct depth', async () => {
      // MAX_LINK_DEPTH = 1, so parent depth 0 → child depth 1
      mockSend.mockResolvedValue({ Item: { ...mockParentFile, depth: 0 } });
      mockLoadTextFromS3.mockResolvedValue('https://sam.gov/file.pdf');
      mockDetectAttachmentLinks.mockReturnValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
      ]);
      mockFilterDocumentLinks.mockResolvedValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
      ]);
      mockImportAttachments.mockResolvedValue([]);

      await handler(baseInput);

      expect(mockImportAttachments).toHaveBeenCalledWith(
        expect.objectContaining({
          depth: 1, // parentDepth (0) + 1
        }),
      );
    });

    it('invokes importAttachments with sourceDocumentId set to parent questionFileId', async () => {
      mockSend.mockResolvedValue({ Item: mockParentFile });
      mockLoadTextFromS3.mockResolvedValue('https://sam.gov/file.pdf');
      mockDetectAttachmentLinks.mockReturnValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
      ]);
      mockFilterDocumentLinks.mockResolvedValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
      ]);
      mockImportAttachments.mockResolvedValue([]);

      await handler(baseInput);

      expect(mockImportAttachments).toHaveBeenCalledWith(
        expect.objectContaining({
          sourceDocumentId: 'qf-123', // parent questionFileId
        }),
      );
    });

    it('invokes importAttachments with parentFileName from originalFileName', async () => {
      mockSend.mockResolvedValue({ Item: mockParentFile });
      mockLoadTextFromS3.mockResolvedValue('https://sam.gov/file.pdf');
      mockDetectAttachmentLinks.mockReturnValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
      ]);
      mockFilterDocumentLinks.mockResolvedValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
      ]);
      mockImportAttachments.mockResolvedValue([]);

      await handler(baseInput);

      expect(mockImportAttachments).toHaveBeenCalledWith(
        expect.objectContaining({
          parentFileName: 'RFP Document.pdf',
        }),
      );
    });

    it('falls back to fileKey basename when originalFileName is missing', async () => {
      mockSend.mockResolvedValue({
        Item: { ...mockParentFile, originalFileName: undefined },
      });
      mockLoadTextFromS3.mockResolvedValue('https://sam.gov/file.pdf');
      mockDetectAttachmentLinks.mockReturnValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
      ]);
      mockFilterDocumentLinks.mockResolvedValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
      ]);
      mockImportAttachments.mockResolvedValue([]);

      await handler(baseInput);

      expect(mockImportAttachments).toHaveBeenCalledWith(
        expect.objectContaining({
          parentFileName: 'document.pdf', // from fileKey
        }),
      );
    });

    it('returns childQuestionFileIds from successful imports', async () => {
      mockSend.mockResolvedValue({ Item: mockParentFile });
      mockLoadTextFromS3.mockResolvedValue('https://sam.gov/file.pdf');
      mockDetectAttachmentLinks.mockReturnValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
      ]);
      mockFilterDocumentLinks.mockResolvedValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
      ]);
      mockImportAttachments.mockResolvedValue([
        { questionFileId: 'child-qf-1', fileKey: 'files/child.pdf' },
        { questionFileId: 'child-qf-2', fileKey: 'files/child2.pdf' },
      ]);

      const result = await handler(baseInput);

      expect(result.importedAttachments).toBe(2);
      expect(result.childQuestionFileIds).toEqual(['child-qf-1', 'child-qf-2']);
    });

    it('returns error when orgId is not available', async () => {
      mockSend.mockResolvedValue({
        Item: { ...mockParentFile, orgId: undefined },
      });
      mockLoadTextFromS3.mockResolvedValue('https://sam.gov/file.pdf');
      mockDetectAttachmentLinks.mockReturnValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
      ]);
      mockFilterDocumentLinks.mockResolvedValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
      ]);

      const result = await handler({ ...baseInput, orgId: undefined });

      expect(result.errors).toContain('orgId not available');
      expect(mockImportAttachments).not.toHaveBeenCalled();
    });

    it('uses orgId from input if provided', async () => {
      mockSend.mockResolvedValue({ Item: mockParentFile });
      mockLoadTextFromS3.mockResolvedValue('https://sam.gov/file.pdf');
      mockDetectAttachmentLinks.mockReturnValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
      ]);
      mockFilterDocumentLinks.mockResolvedValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
      ]);
      mockImportAttachments.mockResolvedValue([]);

      await handler({ ...baseInput, orgId: 'input-org-id' });

      expect(mockImportAttachments).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'input-org-id',
        }),
      );
    });

    it('captures import error in output', async () => {
      mockSend.mockResolvedValue({ Item: mockParentFile });
      mockLoadTextFromS3.mockResolvedValue('https://sam.gov/file.pdf');
      mockDetectAttachmentLinks.mockReturnValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
      ]);
      mockFilterDocumentLinks.mockResolvedValue([
        { url: 'https://sam.gov/file.pdf', filename: 'file.pdf' },
      ]);
      mockImportAttachments.mockRejectedValue(new Error('Download timeout'));

      const result = await handler(baseInput);

      expect(result.errors).toContain('Import failed: Download timeout');
    });
  });
});
