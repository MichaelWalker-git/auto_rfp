import { describe, it, expect, jest, beforeEach } from '@jest/globals';

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
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({
    send: mockSend,
  })),
  GetObjectCommand: jest.fn((params) => ({ type: 'GetObjectCommand', params })),
  PutObjectCommand: jest.fn((params) => ({ type: 'PutObjectCommand', params })),
  DeleteObjectCommand: jest.fn((params) => ({ type: 'DeleteObjectCommand', params })),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn(() => Promise.resolve('https://s3.example.com/presigned-url')),
}));

// Mock helpers
jest.mock('@/helpers/required-form', () => ({
  listRequiredFormsByOpportunity: jest.fn(),
}));

jest.mock('@/helpers/pdf-form-filler', () => ({
  fillPdfForm: jest.fn(),
}));

jest.mock('@/helpers/s3', () => ({
  getFileFromS3: jest.fn(),
}));

jest.mock('@/helpers/api', () => ({
  apiResponse: jest.fn((status, body) => ({ statusCode: status, body: JSON.stringify(body) })),
  getOrgId: jest.fn((event) => event.auth?.orgId || 'test-org-id'),
}));

jest.mock('@/middleware/audit-middleware', () => ({
  setAuditContext: jest.fn(),
  auditMiddleware: jest.fn(() => ({
    before: jest.fn(),
    after: jest.fn(),
  })),
}));

// Mock pdf-lib
jest.mock('pdf-lib', () => ({
  PDFDocument: {
    create: jest.fn(() => ({
      addPage: jest.fn(),
      copyPages: jest.fn(() => Promise.resolve([{ type: 'page' }])),
      save: jest.fn(() => Promise.resolve(new Uint8Array([5, 6, 7, 8]))),
    })),
    load: jest.fn(() => Promise.resolve({
      getPageIndices: jest.fn(() => [0]),
      getPageCount: jest.fn(() => 5), // Mock: PDF has 5 pages
    })),
  },
}));

// Set required environment variables
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.PRESIGN_EXPIRES_IN = '3600';

import { baseHandler } from './export-all-required-forms';
import { listRequiredFormsByOpportunity } from '@/helpers/required-form';
import { fillPdfForm } from '@/helpers/pdf-form-filler';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

const mockListRequiredForms = listRequiredFormsByOpportunity as jest.MockedFunction<
  typeof listRequiredFormsByOpportunity
>;
const mockFillPdfForm = fillPdfForm as jest.MockedFunction<typeof fillPdfForm>;

describe('export-all-required-forms', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  const createMockEvent = (body: unknown): AuthedEvent => ({
    body: JSON.stringify(body),
    headers: {},
    requestContext: {} as AuthedEvent['requestContext'],
    isBase64Encoded: false,
    rawPath: '/required-forms/export-all',
    rawQueryString: '',
    routeKey: 'POST /required-forms/export-all',
    version: '2.0',
    auth: {
      sub: 'user-123',
      email: 'test@example.com',
      orgId: 'org-123',
    },
    rbac: {
      permissions: new Set(['proposal:create']),
      role: 'admin',
    },
  });

  describe('validation', () => {
    it('should return 400 if body is missing', async () => {
      const event: AuthedEvent = {
        ...createMockEvent({}),
        body: null,
      };

      const result = await baseHandler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 400 if projectId is missing', async () => {
      const event = createMockEvent({ opportunityId: 'opp-123' });
      const result = await baseHandler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should return 400 if opportunityId is missing', async () => {
      const event = createMockEvent({ projectId: 'proj-123' });
      const result = await baseHandler(event);
      expect(result.statusCode).toBe(400);
    });
  });

  describe('individual export mode', () => {
    it('should return 400 if no exportable forms exist', async () => {
      mockListRequiredForms.mockResolvedValue([]);

      const event = createMockEvent({
        projectId: 'proj-123',
        opportunityId: 'opp-123',
      });

      const result = await baseHandler(event);
      expect(result.statusCode).toBe(400);
      expect(mockListRequiredForms).toHaveBeenCalledWith({
        orgId: 'org-123',
        projectId: 'proj-123',
        opportunityId: 'opp-123',
      });
    });

    it('should successfully export forms as individual PDFs in ZIP', async () => {
      const mockForms = [
        {
          formId: 'form-1',
          name: 'Form 1',
          fields: [{ fieldId: 'field-1', value: 'test' }],
          sourceFileKey: 's3://bucket/form1.pdf',
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
        },
        {
          formId: 'form-2',
          name: 'Form 2',
          fields: [{ fieldId: 'field-2', value: 'test2' }],
          sourceFileKey: 's3://bucket/form2.pdf',
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
        },
      ];

      mockListRequiredForms.mockResolvedValue(mockForms as never);
      mockFillPdfForm.mockResolvedValue(undefined);

      // Mock S3 get response
      mockSend.mockResolvedValue({
        Body: {
          transformToByteArray: async () => new Uint8Array([1, 2, 3, 4]),
        },
      });

      const event = createMockEvent({
        projectId: 'proj-123',
        opportunityId: 'opp-123',
      });

      const result = await baseHandler(event);
      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body as string);
      expect(body.success).toBe(true);
      expect(body.export.url).toBe('https://s3.example.com/presigned-url');
      expect(body.summary.totalForms).toBe(2);
    });
  });

  describe('merged export mode', () => {
    it('should return 400 if no forms selected', async () => {
      const event = createMockEvent({
        projectId: 'proj-123',
        opportunityId: 'opp-123',
        mode: 'merged',
        documentIds: [],
      });

      const result = await baseHandler(event);
      expect(result.statusCode).toBe(400);
    });

    it('should successfully merge selected forms', async () => {
      const mockForms = [
        {
          formId: 'form-1',
          name: 'Form 1',
          fields: [{ fieldId: 'field-1', value: 'test' }],
          sourceFileKey: 's3://bucket/form1.pdf',
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
        },
      ];

      mockListRequiredForms.mockResolvedValue(mockForms as never);
      mockFillPdfForm.mockResolvedValue(undefined);

      mockSend.mockResolvedValue({
        Body: {
          transformToByteArray: async () => new Uint8Array([1, 2, 3, 4]),
        },
      });

      const event = createMockEvent({
        projectId: 'proj-123',
        opportunityId: 'opp-123',
        mode: 'merged',
        documentIds: ['form-1'],
        fileName: 'Merged Package',
      });

      const result = await baseHandler(event);
      expect(result.statusCode).toBe(200);

      const body = JSON.parse(result.body as string);
      expect(body.success).toBe(true);
      expect(body.fileName).toContain('Merged Package');
    });
  });

  describe('error handling', () => {
    it('should handle form export failure gracefully', async () => {
      const mockForms = [
        {
          formId: 'form-1',
          name: 'Form 1',
          fields: [{ fieldId: 'field-1', value: 'test' }],
          sourceFileKey: 's3://bucket/form1.pdf',
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
        },
      ];

      mockListRequiredForms.mockResolvedValue(mockForms as never);
      mockFillPdfForm.mockRejectedValue(new Error('PDF fill failed'));

      const event = createMockEvent({
        projectId: 'proj-123',
        opportunityId: 'opp-123',
      });

      const result = await baseHandler(event);
      expect(result.statusCode).toBe(500);
    });
  });
});
