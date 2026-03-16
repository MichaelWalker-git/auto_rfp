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
  uploadToS3: jest.fn().mockResolvedValue(undefined),
}));

// Set required environment variables
process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';
process.env['DOCUMENTS_BUCKET'] = 'test-bucket';

import { baseHandler } from './cherry-pick-version';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import { writeAuditLog } from '@/helpers/audit-log';

const makeEvent = (body: Record<string, unknown> = {}, query: Record<string, string> = {}): AuthedEvent =>
  ({
    body: JSON.stringify(body),
    queryStringParameters: query,
    headers: { 'x-org-id': (body['orgId'] ?? query['orgId']) as string, 'user-agent': 'test' },
    requestContext: { http: { sourceIp: '127.0.0.1' } },
    auth: {
      userId: '77777777-7777-4777-8777-777777777777',
      userName: 'Test User',
      claims: {},
      orgId: (body['orgId'] ?? query['orgId']) as string,
    },
  } as unknown as AuthedEvent);

const mockDocument = {
  documentId: '44444444-4444-4444-8444-444444444444',
  projectId: '22222222-2222-4222-8222-222222222222',
  opportunityId: '33333333-3333-4333-8333-333333333333',
  orgId: '11111111-1111-4111-8111-111111111111',
  title: 'Test Document',
  documentType: 'TECHNICAL_PROPOSAL',
  deletedAt: undefined,
  editHistory: [],
};

const mockVersion1 = {
  versionId: 'ver-1',
  documentId: '44444444-4444-4444-8444-444444444444',
  projectId: '22222222-2222-4222-8222-222222222222',
  opportunityId: '33333333-3333-4333-8333-333333333333',
  orgId: '11111111-1111-4111-8111-111111111111',
  versionNumber: 1,
  htmlContentKey: 'org-123/proj-123/opp-123/rfp-documents/doc-123/versions/v1.html',
  title: 'Test Document',
  documentType: 'TECHNICAL_PROPOSAL',
  createdBy: '77777777-7777-4777-8777-777777777777',
  createdAt: '2025-01-01T00:00:00.000Z',
};

describe('cherry-pick-version handler', () => {
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
        orgId: '11111111-1111-4111-8111-111111111111',
        projectId: '22222222-2222-4222-8222-222222222222',
        opportunityId: '33333333-3333-4333-8333-333333333333',
        documentId: '44444444-4444-4444-8444-444444444444',
        sourceVersion: 1,
        mergedHtml: '<p>Merged content</p>',
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

    it('returns 400 when sourceVersion is missing', async () => {
      const result = await baseHandler(
        makeEvent({
          orgId: '11111111-1111-4111-8111-111111111111',
          projectId: '22222222-2222-4222-8222-222222222222',
          opportunityId: '33333333-3333-4333-8333-333333333333',
          documentId: '44444444-4444-4444-8444-444444444444',
          mergedHtml: '<p>Merged content</p>',
        }),
      );
      expect(result).toMatchObject({ statusCode: 400 });
    });

    it('returns 400 when mergedHtml is missing', async () => {
      const result = await baseHandler(
        makeEvent({
          orgId: '11111111-1111-4111-8111-111111111111',
          projectId: '22222222-2222-4222-8222-222222222222',
          opportunityId: '33333333-3333-4333-8333-333333333333',
          documentId: '44444444-4444-4444-8444-444444444444',
          sourceVersion: 1,
        }),
      );
      expect(result).toMatchObject({ statusCode: 400 });
    });

    it('returns 400 when sourceVersion is not a positive integer', async () => {
      const result = await baseHandler(
        makeEvent({
          orgId: '11111111-1111-4111-8111-111111111111',
          projectId: '22222222-2222-4222-8222-222222222222',
          opportunityId: '33333333-3333-4333-8333-333333333333',
          documentId: '44444444-4444-4444-8444-444444444444',
          sourceVersion: 0,
          mergedHtml: '<p>Merged content</p>',
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
          orgId: '11111111-1111-4111-8111-111111111111',
          projectId: '22222222-2222-4222-8222-222222222222',
          opportunityId: '33333333-3333-4333-8333-333333333333',
          documentId: '44444444-4444-4444-8444-444444444444',
          sourceVersion: 1,
          mergedHtml: '<p>Merged content</p>',
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
          orgId: '11111111-1111-4111-8111-111111111111',
          projectId: '22222222-2222-4222-8222-222222222222',
          opportunityId: '33333333-3333-4333-8333-333333333333',
          documentId: '44444444-4444-4444-8444-444444444444',
          sourceVersion: 1,
          mergedHtml: '<p>Merged content</p>',
        }),
      );
      expect(result).toMatchObject({ statusCode: 403 });
    });
  });

  describe('happy path', () => {
    it('creates new version with merged HTML and updates document', async () => {
      // First call: getRFPDocument
      mockSend.mockResolvedValueOnce({ Item: mockDocument });
      // Second call: listVersions (query for latest version number)
      mockSend.mockResolvedValueOnce({ Items: [{ ...mockVersion1, versionNumber: 2 }] });
      // Third call: createVersion (put)
      mockSend.mockResolvedValueOnce({});
      // Fourth call: updateRFPDocumentMetadata (update)
      mockSend.mockResolvedValueOnce({});

      const result = await baseHandler(
        makeEvent({
          orgId: '11111111-1111-4111-8111-111111111111',
          projectId: '22222222-2222-4222-8222-222222222222',
          opportunityId: '33333333-3333-4333-8333-333333333333',
          documentId: '44444444-4444-4444-8444-444444444444',
          sourceVersion: 1,
          mergedHtml: '<p>Cherry-picked merged content</p>',
          changeNote: 'Cherry-picked changes from version 1',
        }),
      );
      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.ok).toBe(true);
      expect(body.version).toBeDefined();
      expect(body.version.versionNumber).toBe(3); // New version is latest + 1
    });

    it('uses default change note when not provided', async () => {
      mockSend.mockResolvedValueOnce({ Item: mockDocument });
      mockSend.mockResolvedValueOnce({ Items: [mockVersion1] });
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});

      const result = await baseHandler(
        makeEvent({
          orgId: '11111111-1111-4111-8111-111111111111',
          projectId: '22222222-2222-4222-8222-222222222222',
          opportunityId: '33333333-3333-4333-8333-333333333333',
          documentId: '44444444-4444-4444-8444-444444444444',
          sourceVersion: 1,
          mergedHtml: '<p>Cherry-picked content</p>',
        }),
      );
      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.version.changeNote).toContain('Cherry-picked');
    });

    it('writes audit log on successful cherry-pick', async () => {
      mockSend.mockResolvedValueOnce({ Item: mockDocument });
      mockSend.mockResolvedValueOnce({ Items: [mockVersion1] });
      mockSend.mockResolvedValueOnce({});
      mockSend.mockResolvedValueOnce({});

      await baseHandler(
        makeEvent({
          orgId: '11111111-1111-4111-8111-111111111111',
          projectId: '22222222-2222-4222-8222-222222222222',
          opportunityId: '33333333-3333-4333-8333-333333333333',
          documentId: '44444444-4444-4444-8444-444444444444',
          sourceVersion: 1,
          mergedHtml: '<p>Cherry-picked content</p>',
        }),
      );

      // Wait for non-blocking audit log
      await new Promise((resolve) => setTimeout(resolve, 10));
      
      expect(writeAuditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'DOCUMENT_VERSION_CHERRYPICKED',
          resource: 'document_version',
          resourceId: expect.any(String), // versionId is generated by uuid.v4()
          changes: expect.objectContaining({
            after: expect.objectContaining({
              documentId: '44444444-4444-4444-8444-444444444444',
            }),
          }),
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
            orgId: '11111111-1111-4111-8111-111111111111',
            projectId: '22222222-2222-4222-8222-222222222222',
            opportunityId: '33333333-3333-4333-8333-333333333333',
            documentId: '44444444-4444-4444-8444-444444444444',
            sourceVersion: 1,
            mergedHtml: '<p>Content</p>',
          }),
        ),
      ).rejects.toThrow('DynamoDB error');
    });
  });
});
