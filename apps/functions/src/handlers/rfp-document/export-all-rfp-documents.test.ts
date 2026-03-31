// Mock middy before importing handlers
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

// Mock AWS SDK
const mockSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: mockSend })),
  },
  QueryCommand: jest.fn((params) => ({ type: 'Query', params })),
  GetCommand: jest.fn((params) => ({ type: 'Get', params })),
}));

// Mock S3
const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn((params) => ({ type: 'PutObject', params })),
  GetObjectCommand: jest.fn((params) => ({ type: 'GetObject', params })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://s3.example.com/presigned-zip-url'),
}));

// Mock JSZip
const mockZipFile = jest.fn();
const mockZipGenerateAsync = jest.fn().mockResolvedValue(Buffer.from('fake-zip-content'));
jest.mock('jszip', () => {
  return jest.fn().mockImplementation(() => ({
    file: mockZipFile,
    generateAsync: mockZipGenerateAsync,
  }));
});

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
  auditMiddleware: jest.fn(() => ({ after: jest.fn() })),
  setAuditContext: jest.fn(),
}));

// Mock export helpers
const mockLoadDocumentHtmlForExport = jest.fn();
jest.mock('@/helpers/export', () => ({
  sanitizeFileName: jest.fn((name: string) =>
    (name || 'proposal').replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 160),
  ),
  loadDocumentHtmlForExport: (...args: unknown[]) => mockLoadDocumentHtmlForExport(...args),
  FILE_EXTENSIONS: {
    pdf: '.pdf',
    docx: '.docx',
    pptx: '.pptx',
    html: '.html',
    txt: '.txt',
    md: '.md',
  },
}));

const mockHtmlToPdfBuffer = jest.fn();
jest.mock('@/helpers/export-pdf', () => ({
  htmlToPdfBuffer: (...args: unknown[]) => mockHtmlToPdfBuffer(...args),
}));

const mockHtmlToDocxBuffer = jest.fn();
jest.mock('@/helpers/export-docx', () => ({
  htmlToDocxBuffer: (...args: unknown[]) => mockHtmlToDocxBuffer(...args),
}));

const mockHtmlToPptxBuffer = jest.fn();
jest.mock('@/helpers/export-pptx', () => ({
  htmlToPptxBuffer: (...args: unknown[]) => mockHtmlToPptxBuffer(...args),
}));

jest.mock('@/helpers/export-html-builder', () => ({
  buildExportHtml: jest.fn((html: string) => `<html>${html}</html>`),
}));

// Mock rfp-document helper
const mockListRFPDocumentsByProject = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  listRFPDocumentsByProject: (...args: unknown[]) => mockListRFPDocumentsByProject(...args),
}));

// Set required environment variables
process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';
process.env['DOCUMENTS_BUCKET'] = 'test-bucket';

import { baseHandler } from './export-all-rfp-documents';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import { setAuditContext } from '@/middleware/audit-middleware';
import { TEST_IDS } from './test-helpers';

const makeEvent = (body: Record<string, unknown>): AuthedEvent =>
  ({
    body: JSON.stringify(body),
    headers: { 'x-org-id': TEST_IDS.ORG_ID },
    queryStringParameters: { orgId: TEST_IDS.ORG_ID },
    requestContext: { http: { sourceIp: '127.0.0.1' } },
    auth: { userId: TEST_IDS.USER_ID, claims: {}, orgId: TEST_IDS.ORG_ID },
  } as unknown as AuthedEvent);

const mockDocuments = [
  {
    documentId: 'doc-1',
    projectId: TEST_IDS.PROJECT_ID,
    opportunityId: TEST_IDS.OPPORTUNITY_ID,
    orgId: TEST_IDS.ORG_ID,
    name: 'Technical Proposal',
    title: 'Technical Proposal',
    documentType: 'TECHNICAL_PROPOSAL',
    status: 'READY',
    htmlContentKey: 'org/proj/opp/rfp-documents/doc-1/content.html',
    content: { title: 'Technical Proposal' },
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
  },
  {
    documentId: 'doc-2',
    projectId: TEST_IDS.PROJECT_ID,
    opportunityId: TEST_IDS.OPPORTUNITY_ID,
    orgId: TEST_IDS.ORG_ID,
    name: 'Management Approach',
    title: 'Management Approach',
    documentType: 'MANAGEMENT_APPROACH',
    status: 'READY',
    htmlContentKey: 'org/proj/opp/rfp-documents/doc-2/content.html',
    content: { title: 'Management Approach' },
    createdAt: '2025-01-02T00:00:00.000Z',
    updatedAt: '2025-01-02T00:00:00.000Z',
  },
];

describe('export-all-rfp-documents handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    mockS3Send.mockReset();
    mockListRFPDocumentsByProject.mockReset();
    mockLoadDocumentHtmlForExport.mockReset();
    mockHtmlToPdfBuffer.mockReset();
    mockHtmlToDocxBuffer.mockReset();
    mockZipFile.mockReset();
    mockZipGenerateAsync.mockReset().mockResolvedValue(Buffer.from('fake-zip-content'));
    mockS3Send.mockResolvedValue({});
  });

  describe('validation', () => {
    it('returns 400 when body is missing', async () => {
      const event = {
        headers: { 'x-org-id': TEST_IDS.ORG_ID },
        queryStringParameters: { orgId: TEST_IDS.ORG_ID },
        requestContext: { http: { sourceIp: '127.0.0.1' } },
        auth: { userId: TEST_IDS.USER_ID, claims: {}, orgId: TEST_IDS.ORG_ID },
      } as unknown as AuthedEvent;

      const result = await baseHandler(event);
      expect(result).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('Request body is required');
    });

    it('returns 400 when projectId is missing', async () => {
      const result = await baseHandler(makeEvent({}));
      expect(result).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('projectId is required');
    });
  });

  describe('no documents', () => {
    it('returns 400 when no documents exist', async () => {
      mockListRFPDocumentsByProject.mockResolvedValue({ items: [], nextToken: null });

      const result = await baseHandler(
        makeEvent({ projectId: TEST_IDS.PROJECT_ID, opportunityId: TEST_IDS.OPPORTUNITY_ID }),
      );
      expect(result).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('No documents available for export');
    });

    it('returns 400 when documents exist but none have exportable content', async () => {
      mockListRFPDocumentsByProject.mockResolvedValue({
        items: [
          {
            documentId: 'doc-no-content',
            projectId: TEST_IDS.PROJECT_ID,
            opportunityId: TEST_IDS.OPPORTUNITY_ID,
            orgId: TEST_IDS.ORG_ID,
            name: 'Empty Doc',
            status: 'READY',
            // No htmlContentKey or content
          },
        ],
        nextToken: null,
      });

      const result = await baseHandler(
        makeEvent({ projectId: TEST_IDS.PROJECT_ID, opportunityId: TEST_IDS.OPPORTUNITY_ID }),
      );
      expect(result).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('No documents with exportable content');
    });

    it('filters out GENERATING documents', async () => {
      mockListRFPDocumentsByProject.mockResolvedValue({
        items: [
          {
            documentId: 'doc-generating',
            projectId: TEST_IDS.PROJECT_ID,
            opportunityId: TEST_IDS.OPPORTUNITY_ID,
            orgId: TEST_IDS.ORG_ID,
            name: 'Generating Doc',
            status: 'GENERATING',
            htmlContentKey: 'some-key',
          },
        ],
        nextToken: null,
      });

      const result = await baseHandler(
        makeEvent({ projectId: TEST_IDS.PROJECT_ID, opportunityId: TEST_IDS.OPPORTUNITY_ID }),
      );
      expect(result).toMatchObject({ statusCode: 400 });
    });

    it('filters out documents from other orgs', async () => {
      mockListRFPDocumentsByProject.mockResolvedValue({
        items: [
          {
            documentId: 'doc-other-org',
            projectId: TEST_IDS.PROJECT_ID,
            opportunityId: TEST_IDS.OPPORTUNITY_ID,
            orgId: 'other-org-id',
            name: 'Other Org Doc',
            status: 'READY',
            htmlContentKey: 'some-key',
          },
        ],
        nextToken: null,
      });

      const result = await baseHandler(
        makeEvent({ projectId: TEST_IDS.PROJECT_ID, opportunityId: TEST_IDS.OPPORTUNITY_ID }),
      );
      expect(result).toMatchObject({ statusCode: 400 });
    });
  });

  describe('happy path', () => {
    it('exports all documents as DOCX + PDF in a ZIP', async () => {
      mockListRFPDocumentsByProject.mockResolvedValue({
        items: mockDocuments,
        nextToken: null,
      });

      mockLoadDocumentHtmlForExport
        .mockResolvedValueOnce('<h1>Technical Proposal</h1><p>Content 1</p>')
        .mockResolvedValueOnce('<h1>Management Approach</h1><p>Content 2</p>');

      mockHtmlToDocxBuffer
        .mockResolvedValueOnce(Buffer.from('docx-content-1'))
        .mockResolvedValueOnce(Buffer.from('docx-content-2'));

      mockHtmlToPdfBuffer
        .mockResolvedValueOnce(Buffer.from('pdf-content-1'))
        .mockResolvedValueOnce(Buffer.from('pdf-content-2'));

      const result = await baseHandler(
        makeEvent({ projectId: TEST_IDS.PROJECT_ID, opportunityId: TEST_IDS.OPPORTUNITY_ID }),
      );

      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);

      expect(body.success).toBe(true);
      expect(body.export.url).toBe('https://s3.example.com/presigned-zip-url');
      expect(body.export.contentType).toBe('application/zip');
      expect(body.summary.totalDocuments).toBe(2);
      expect(body.summary.exportedDocuments).toBe(2);
      expect(body.summary.skippedDocuments).toBe(0);
      expect(body.summary.formats).toEqual(['docx', 'pdf']);

      // Verify ZIP file was populated with 4 files (2 docs × 2 formats)
      expect(mockZipFile).toHaveBeenCalledTimes(4);
      expect(mockZipFile).toHaveBeenCalledWith('Technical_Proposal.docx', expect.any(Buffer));
      expect(mockZipFile).toHaveBeenCalledWith('Technical_Proposal.pdf', expect.any(Buffer));
      expect(mockZipFile).toHaveBeenCalledWith('Management_Approach.docx', expect.any(Buffer));
      expect(mockZipFile).toHaveBeenCalledWith('Management_Approach.pdf', expect.any(Buffer));

      // Verify S3 upload was called
      expect(mockS3Send).toHaveBeenCalled();

      // Verify audit context was set
      expect(setAuditContext).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          action: 'DOCUMENTS_BULK_EXPORTED',
          resource: 'rfp_document',
          resourceId: TEST_IDS.PROJECT_ID,
        }),
      );
    });

    it('exports single document correctly', async () => {
      mockListRFPDocumentsByProject.mockResolvedValue({
        items: [mockDocuments[0]],
        nextToken: null,
      });

      mockLoadDocumentHtmlForExport.mockResolvedValueOnce('<h1>Technical Proposal</h1>');
      mockHtmlToDocxBuffer.mockResolvedValueOnce(Buffer.from('docx-content'));
      mockHtmlToPdfBuffer.mockResolvedValueOnce(Buffer.from('pdf-content'));

      const result = await baseHandler(
        makeEvent({ projectId: TEST_IDS.PROJECT_ID, opportunityId: TEST_IDS.OPPORTUNITY_ID }),
      );

      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.summary.totalDocuments).toBe(1);
      expect(body.summary.exportedDocuments).toBe(1);
      expect(mockZipFile).toHaveBeenCalledTimes(2);
    });

    it('passes pageSize option to export functions', async () => {
      mockListRFPDocumentsByProject.mockResolvedValue({
        items: [mockDocuments[0]],
        nextToken: null,
      });

      mockLoadDocumentHtmlForExport.mockResolvedValueOnce('<h1>Test</h1>');
      mockHtmlToDocxBuffer.mockResolvedValueOnce(Buffer.from('docx'));
      mockHtmlToPdfBuffer.mockResolvedValueOnce(Buffer.from('pdf'));

      await baseHandler(
        makeEvent({
          projectId: TEST_IDS.PROJECT_ID,
          opportunityId: TEST_IDS.OPPORTUNITY_ID,
          options: { pageSize: 'a4' },
        }),
      );

      expect(mockHtmlToDocxBuffer).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ pageSize: 'a4' }),
      );
      expect(mockHtmlToPdfBuffer).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ pageSize: 'a4' }),
      );
    });
  });

  describe('partial failures', () => {
    it('skips documents with blank content', async () => {
      mockListRFPDocumentsByProject.mockResolvedValue({
        items: mockDocuments,
        nextToken: null,
      });

      // First doc has content, second returns empty
      mockLoadDocumentHtmlForExport
        .mockResolvedValueOnce('<h1>Technical Proposal</h1><p>Content</p>')
        .mockResolvedValueOnce('');

      mockHtmlToDocxBuffer.mockResolvedValueOnce(Buffer.from('docx-content'));
      mockHtmlToPdfBuffer.mockResolvedValueOnce(Buffer.from('pdf-content'));

      const result = await baseHandler(
        makeEvent({ projectId: TEST_IDS.PROJECT_ID, opportunityId: TEST_IDS.OPPORTUNITY_ID }),
      );

      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.summary.exportedDocuments).toBe(1);
      expect(body.summary.skippedDocuments).toBe(1);

      const skippedDoc = body.documents.find((d: { skipped: boolean }) => d.skipped);
      expect(skippedDoc).toBeDefined();
      expect(skippedDoc.skipReason).toContain('blank');
    });

    it('skips documents when HTML loading fails', async () => {
      mockListRFPDocumentsByProject.mockResolvedValue({
        items: mockDocuments,
        nextToken: null,
      });

      mockLoadDocumentHtmlForExport
        .mockResolvedValueOnce('<h1>Technical Proposal</h1><p>Content</p>')
        .mockRejectedValueOnce(new Error('S3 load failed'));

      mockHtmlToDocxBuffer.mockResolvedValueOnce(Buffer.from('docx-content'));
      mockHtmlToPdfBuffer.mockResolvedValueOnce(Buffer.from('pdf-content'));

      const result = await baseHandler(
        makeEvent({ projectId: TEST_IDS.PROJECT_ID, opportunityId: TEST_IDS.OPPORTUNITY_ID }),
      );

      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.summary.exportedDocuments).toBe(1);
      expect(body.summary.skippedDocuments).toBe(1);

      const skippedDoc = body.documents.find((d: { skipped: boolean }) => d.skipped);
      expect(skippedDoc.skipReason).toContain('Failed to load');
    });

    it('skips documents when export conversion fails', async () => {
      mockListRFPDocumentsByProject.mockResolvedValue({
        items: mockDocuments,
        nextToken: null,
      });

      mockLoadDocumentHtmlForExport
        .mockResolvedValueOnce('<h1>Technical Proposal</h1>')
        .mockResolvedValueOnce('<h1>Management Approach</h1>');

      // First doc exports fine
      mockHtmlToDocxBuffer
        .mockResolvedValueOnce(Buffer.from('docx-content'))
        // Second doc fails
        .mockRejectedValueOnce(new Error('DOCX conversion failed'));

      mockHtmlToPdfBuffer
        .mockResolvedValueOnce(Buffer.from('pdf-content'))
        .mockRejectedValueOnce(new Error('PDF conversion failed'));

      const result = await baseHandler(
        makeEvent({ projectId: TEST_IDS.PROJECT_ID, opportunityId: TEST_IDS.OPPORTUNITY_ID }),
      );

      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.summary.exportedDocuments).toBe(1);
      expect(body.summary.skippedDocuments).toBe(1);
    });

    it('returns 500 when all documents fail to export', async () => {
      mockListRFPDocumentsByProject.mockResolvedValue({
        items: [mockDocuments[0]],
        nextToken: null,
      });

      mockLoadDocumentHtmlForExport.mockResolvedValueOnce('   '); // whitespace only

      const result = await baseHandler(
        makeEvent({ projectId: TEST_IDS.PROJECT_ID, opportunityId: TEST_IDS.OPPORTUNITY_ID }),
      );

      expect(result).toMatchObject({ statusCode: 500 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('Failed to export any documents');
    });
  });

  describe('error handling', () => {
    it('returns 500 on unexpected errors', async () => {
      mockListRFPDocumentsByProject.mockRejectedValue(new Error('DynamoDB error'));

      const result = await baseHandler(
        makeEvent({ projectId: TEST_IDS.PROJECT_ID, opportunityId: TEST_IDS.OPPORTUNITY_ID }),
      );

      expect(result).toMatchObject({ statusCode: 500 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('Failed to export documents');
    });
  });
});
