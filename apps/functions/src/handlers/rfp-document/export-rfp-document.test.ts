jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

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

const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  PutObjectCommand: jest.fn((params) => ({ type: 'PutObject', params })),
  GetObjectCommand: jest.fn((params: Record<string, unknown>) => ({ type: 'GetObject', params })),
}));

const mockGetSignedUrl = jest.fn();
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
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
  auditMiddleware: jest.fn(() => ({ after: jest.fn() })),
  setAuditContext: jest.fn(),
}));

const mockGetRFPDocument = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  getRFPDocument: (...args: unknown[]) => mockGetRFPDocument(...args),
}));

const mockLoadDocumentHtmlForExport = jest.fn();
jest.mock('@/helpers/export', () => ({
  sanitizeFileName: jest.fn((name: string) =>
    (name || 'proposal').replace(/[^\w\s-]/g, '').replace(/\s+/g, '_').slice(0, 160),
  ),
  loadDocumentHtmlForExport: (...args: unknown[]) => mockLoadDocumentHtmlForExport(...args),
  expandTableOfContents: jest.fn((html: string) => html),
  CONTENT_TYPES: {
    pdf: 'application/pdf',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    html: 'text/html; charset=utf-8',
    txt: 'text/plain; charset=utf-8',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    md: 'text/markdown; charset=utf-8',
  },
  FILE_EXTENSIONS: {
    pdf: '.pdf',
    docx: '.docx',
    pptx: '.pptx',
    html: '.html',
    txt: '.txt',
    md: '.md',
  },
}));

jest.mock('@/helpers/export-pdf', () => ({
  htmlToPdfBuffer: jest.fn().mockResolvedValue(Buffer.from('fake-pdf')),
}));
jest.mock('@/helpers/export-docx', () => ({
  htmlToDocxBuffer: jest.fn().mockResolvedValue(Buffer.from('fake-docx')),
}));
jest.mock('@/helpers/export-pptx', () => ({
  htmlToPptxBuffer: jest.fn().mockResolvedValue(Buffer.from('fake-pptx')),
}));
jest.mock('@/helpers/export-html-builder', () => ({
  buildExportHtml: jest.fn((html: string) => `<html>${html}</html>`),
}));

process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';
process.env['DOCUMENTS_BUCKET'] = 'test-bucket';

import { baseHandler } from './export-rfp-document';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import { TEST_IDS } from './test-helpers';

const makeEvent = (body: Record<string, unknown>): AuthedEvent =>
  ({
    body: JSON.stringify(body),
    headers: { 'x-org-id': TEST_IDS.ORG_ID },
    queryStringParameters: { orgId: TEST_IDS.ORG_ID },
    requestContext: { http: { sourceIp: '127.0.0.1' } },
    auth: { userId: TEST_IDS.USER_ID, claims: {}, orgId: TEST_IDS.ORG_ID },
  } as unknown as AuthedEvent);

const mockDocument = {
  documentId: TEST_IDS.DOCUMENT_ID,
  projectId: TEST_IDS.PROJECT_ID,
  opportunityId: TEST_IDS.OPPORTUNITY_ID,
  orgId: TEST_IDS.ORG_ID,
  name: 'Technical Proposal',
  title: 'Technical Proposal',
  documentType: 'TECHNICAL_PROPOSAL',
  htmlContentKey: 'org/proj/opp/rfp-documents/doc/content.html',
  content: { title: 'Technical Proposal' },
};

describe('export-rfp-document', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockS3Send.mockReset().mockResolvedValue({});
    mockGetSignedUrl.mockReset().mockResolvedValue('https://s3.example.com/presigned-export-url');
    mockGetRFPDocument.mockReset().mockResolvedValue(mockDocument);
    mockLoadDocumentHtmlForExport.mockReset().mockResolvedValue('<h1>Test Content</h1><p>Body</p>');
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
    });

    it('returns 400 when required fields are missing', async () => {
      const result = await baseHandler(makeEvent({ projectId: TEST_IDS.PROJECT_ID }));
      expect(result).toMatchObject({ statusCode: 400 });
    });

    it('returns 400 for unsupported format', async () => {
      const result = await baseHandler(makeEvent({
        projectId: TEST_IDS.PROJECT_ID,
        opportunityId: TEST_IDS.OPPORTUNITY_ID,
        documentId: TEST_IDS.DOCUMENT_ID,
        format: 'xlsx',
      }));
      expect(result).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('Unsupported');
    });
  });

  describe('access control', () => {
    it('returns 404 when document not found', async () => {
      mockGetRFPDocument.mockResolvedValue(null);
      const result = await baseHandler(makeEvent({
        projectId: TEST_IDS.PROJECT_ID,
        opportunityId: TEST_IDS.OPPORTUNITY_ID,
        documentId: TEST_IDS.DOCUMENT_ID,
        format: 'docx',
      }));
      expect(result).toMatchObject({ statusCode: 404 });
    });

    it('returns 403 when orgId does not match', async () => {
      mockGetRFPDocument.mockResolvedValue({ ...mockDocument, orgId: 'other-org' });
      const result = await baseHandler(makeEvent({
        projectId: TEST_IDS.PROJECT_ID,
        opportunityId: TEST_IDS.OPPORTUNITY_ID,
        documentId: TEST_IDS.DOCUMENT_ID,
        format: 'docx',
      }));
      expect(result).toMatchObject({ statusCode: 403 });
    });
  });

  describe('presigned URL includes ResponseContentDisposition', () => {
    it('sets attachment disposition with filename for DOCX export', async () => {
      const result = await baseHandler(makeEvent({
        projectId: TEST_IDS.PROJECT_ID,
        opportunityId: TEST_IDS.OPPORTUNITY_ID,
        documentId: TEST_IDS.DOCUMENT_ID,
        format: 'docx',
      }));

      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.success).toBe(true);
      expect(body.export.url).toBe('https://s3.example.com/presigned-export-url');

      // Verify GetObjectCommand includes ResponseContentDisposition
      expect(GetObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: 'test-bucket',
          ResponseContentDisposition: expect.stringMatching(/^attachment; filename="/),
        }),
      );
    });

    it('sets attachment disposition with filename for PDF export', async () => {
      await baseHandler(makeEvent({
        projectId: TEST_IDS.PROJECT_ID,
        opportunityId: TEST_IDS.OPPORTUNITY_ID,
        documentId: TEST_IDS.DOCUMENT_ID,
        format: 'pdf',
      }));

      expect(GetObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ResponseContentDisposition: expect.stringContaining('attachment; filename="Technical_Proposal.pdf"'),
        }),
      );
    });

    it('prevents double-encoding by not encoding the presigned URL', async () => {
      // The presigned URL from S3 already contains encoded query params.
      // Verify we pass it through unchanged (no additional encoding layer).
      const presignedWithSpecialChars = 'https://bucket.s3.amazonaws.com/key?X-Amz-Signature=abc%2Fdef&X-Amz-Date=20250501';
      mockGetSignedUrl.mockResolvedValue(presignedWithSpecialChars);

      const result = await baseHandler(makeEvent({
        projectId: TEST_IDS.PROJECT_ID,
        opportunityId: TEST_IDS.OPPORTUNITY_ID,
        documentId: TEST_IDS.DOCUMENT_ID,
        format: 'docx',
      }));

      const body = JSON.parse((result as { body: string }).body);
      // URL must be returned verbatim — no double encoding (%252F instead of %2F)
      expect(body.export.url).toBe(presignedWithSpecialChars);
      expect(body.export.url).not.toContain('%25');
    });
  });

  describe('export formats', () => {
    it('exports plain text without modification', async () => {
      const result = await baseHandler(makeEvent({
        projectId: TEST_IDS.PROJECT_ID,
        opportunityId: TEST_IDS.OPPORTUNITY_ID,
        documentId: TEST_IDS.DOCUMENT_ID,
        format: 'txt',
      }));

      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.export.format).toBe('txt');
      expect(body.export.fileName).toBe('Technical_Proposal.txt');
    });

    it('exports markdown format', async () => {
      const result = await baseHandler(makeEvent({
        projectId: TEST_IDS.PROJECT_ID,
        opportunityId: TEST_IDS.OPPORTUNITY_ID,
        documentId: TEST_IDS.DOCUMENT_ID,
        format: 'md',
      }));

      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.export.format).toBe('md');
      expect(body.export.fileName).toBe('Technical_Proposal.md');
    });
  });

  describe('error handling', () => {
    it('returns 400 when document has no content', async () => {
      mockGetRFPDocument.mockResolvedValue({
        ...mockDocument,
        htmlContentKey: null,
        content: null,
      });

      const result = await baseHandler(makeEvent({
        projectId: TEST_IDS.PROJECT_ID,
        opportunityId: TEST_IDS.OPPORTUNITY_ID,
        documentId: TEST_IDS.DOCUMENT_ID,
        format: 'docx',
      }));
      expect(result).toMatchObject({ statusCode: 400 });
    });

    it('returns 500 when HTML loading fails', async () => {
      mockLoadDocumentHtmlForExport.mockRejectedValue(new Error('S3 error'));

      const result = await baseHandler(makeEvent({
        projectId: TEST_IDS.PROJECT_ID,
        opportunityId: TEST_IDS.OPPORTUNITY_ID,
        documentId: TEST_IDS.DOCUMENT_ID,
        format: 'docx',
      }));
      expect(result).toMatchObject({ statusCode: 500 });
    });
  });
});
