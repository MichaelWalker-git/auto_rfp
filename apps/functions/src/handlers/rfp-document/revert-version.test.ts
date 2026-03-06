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
  PutCommand: jest.fn((params) => ({ type: 'Put', params })),
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
}));

// Mock S3
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

// Mock audit helpers
jest.mock('@/helpers/audit-log', () => ({
  writeAuditLog: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/helpers/secret', () => ({
  getHmacSecret: jest.fn().mockResolvedValue('test-secret'),
}));

// Mock S3 helpers
jest.mock('@/helpers/s3', () => ({
  loadTextFromS3: jest.fn().mockResolvedValue('<p>Version 1 content</p>'),
  uploadToS3: jest.fn().mockResolvedValue(undefined),
}));

// Set required environment variables
process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';
process.env['DOCUMENTS_BUCKET'] = 'test-bucket';

import { baseHandler } from './revert-version';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import { writeAuditLog } from '@/helpers/audit-log';

const makeEvent = (body: Record<string, unknown> = {}, query: Record<string, string> = {}): AuthedEvent =>
  ({
    body: JSON.stringify(body),
    queryStringParameters: query,
    headers: { 'x-org-id': (body['orgId'] ?? query['orgId']) as string, 'user-agent': 'test' },
    requestContext: { http: { sourceIp: '127.0.0.1' } },
    auth: {
      userId: 'user-123',
      userName: 'Test User',
      claims: {},
      orgId: (body['orgId'] ?? query['orgId']) as string,
    },
  } as unknown as AuthedEvent);

const mockDocument = {
  documentId: 'doc-123',
  projectId: 'proj-123',
  opportunityId: 'opp-123',
  orgId: 'org-123',
  title: 'Test Document',
  documentType: 'TECHNICAL_PROPOSAL',
  deletedAt: undefined,
  editHistory: [],
};

const mockVersion1 = {
  versionId: 'ver-1',
  documentId: 'doc-123',
  projectId: 'proj-123',
  opportunityId: 'opp-123',
  orgId: 'org-123',
  versionNumber: 1,
  htmlContentKey: 'org-123/proj-123/opp-123/rfp-documents/doc-123/versions/v1.html',
  title: 'Test Document',
  documentType: 'TECHNICAL_PROPOSAL',
  createdBy: 'user-123',
  createdAt: '2025-01-01T00:00:00.000Z',
};

describe('revert-version handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
  });

  describe('validation', () => {
    it('returns 400 when orgId is missing', async () => {
      const result = await baseHandler(makeEvent({}));
      expect(result).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('orgId');
    });

    it('returns 401 when user is not authenticated', async () => {
      const event = makeEvent({
        orgId: 'org-123',
        projectId: 'proj-123',
        opportunityId: 'opp-123',
        documentId: 'doc-123',
        targetVersion: 1,
      });
      event.auth = undefined as any;
      
      const result = await baseHandler(event);
      expect(result).toMatchObject({ statusCode: 401 });
    });

    it('returns 400 when body is missing', async () => {
      const event = makeEvent({});
      event.body = undefined as any;
      
      const result = await baseHandler(event);
      expect(result).toMatchObject({ statusCode: 400 });
    });

    it('returns 400 when targetVersion is missing', async () => {
      const result = await baseHandler(
        makeEvent({
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
          documentId: 'doc-123',
        }),
      );
      expect(result).toMatchObject({ statusCode: 400 });
    });

    it('returns 400 when targetVersion is not a positive integer', async () => {
      const result = await baseHandler(
        makeEvent({
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
          documentId: 'doc-123',
          targetVersion: 0,
        }),
      );
      expect(result).toMatchObject({ statusCode: 400 });
    });
  });

  describe('document verification', () => {
    it('returns 404 when document does not exist', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await baseHandler(
        makeEvent({
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
          documentId: 'doc-123',
          targetVersion: 1,
        }),
      );
      expect(result).toMatchObject({ statusCode: 404 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toBe('Document not found');
    });

    it('returns 403 when document belongs to different org', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { ...mockDocument, orgId: 'other-org' },
      });

      const result = await baseHandler(
        makeEvent({
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
          documentId: 'doc-123',
          targetVersion: 1,
        }),
      );
      expect(result).toMatchObject({ statusCode: 403 });
    });
  });

  describe('version verification', () => {
    it('returns 404 when target version does not exist', async () => {
      // First call: getRFPDocument
      mockSend.mockResolvedValueOnce({ Item: mockDocument });
      // Second call: getVersion - not found
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await baseHandler(
        makeEvent({
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
          documentId: 'doc-123',
          targetVersion: 99,
        }),
      );
      expect(result).toMatchObject({ statusCode: 404 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('Version 99 not found');
    });
  });

  describe('happy path', () => {
    it('creates new version and updates document', async () => {
      // First call: getRFPDocument
      mockSend.mockResolvedValueOnce({ Item: mockDocument });
      // Second call: getVersion for target
      mockSend.mockResolvedValueOnce({ Item: mockVersion1 });
      // Third call: listVersions (query for latest version number)
      mockSend.mockResolvedValueOnce({ Items: [{ ...mockVersion1, versionNumber: 2 }] });
      // Fourth call: createVersion (put)
      mockSend.mockResolvedValueOnce({});
      // Fifth call: updateRFPDocumentMetadata (update)
      mockSend.mockResolvedValueOnce({});

      const result = await baseHandler(
        makeEvent({
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
          documentId: 'doc-123',
          targetVersion: 1,
          changeNote: 'Reverted to version 1',
        }),
      );
      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.ok).toBe(true);
      expect(body.version).toBeDefined();
      expect(body.version.versionNumber).toBe(3); // New version is latest + 1
    });

    it('writes audit log on successful revert', async () => {
      mockSend.mockResolvedValueOnce({ Item: mockDocument });
      mockSend.mockResolvedValueOnce({ Item: mockVersion1 });
      mockSend.mockResolvedValueOnce({ Items: [mockVersion1] });
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});

      await baseHandler(
        makeEvent({
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
          documentId: 'doc-123',
          targetVersion: 1,
        }),
      );

      // Wait for non-blocking audit log
      await new Promise((resolve) => setTimeout(resolve, 10));
      
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DOCUMENT_VERSION_REVERTED',
          resource: 'document_version',
          resourceId: 'doc-123',
        }),
        expect.any(String),
      );
    });
  });

  describe('error handling', () => {
    it('propagates DynamoDB errors', async () => {
      mockSend.mockRejectedValue(new Error('DynamoDB error'));

      await expect(
        baseHandler(
          makeEvent({
            orgId: 'org-123',
            projectId: 'proj-123',
            opportunityId: 'opp-123',
            documentId: 'doc-123',
            targetVersion: 1,
          }),
        ),
      ).rejects.toThrow('DynamoDB error');
    });
  });
});
