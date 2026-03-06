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
  GetObjectCommand: jest.fn((params) => ({ type: 'GetObject', params })),
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

// Mock S3 helper
jest.mock('@/helpers/s3', () => ({
  loadTextFromS3: jest.fn(),
}));

// Set required environment variables
process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';
process.env['DOCUMENTS_BUCKET'] = 'test-bucket';

import { baseHandler } from './compare-versions';
import type { AuthedEvent } from '@/middleware/rbac-middleware';
import { loadTextFromS3 } from '@/helpers/s3';

const makeEvent = (queryStringParameters: Record<string, string> = {}): AuthedEvent =>
  ({
    queryStringParameters,
    headers: { 'x-org-id': queryStringParameters['orgId'] },
    requestContext: { http: { sourceIp: '127.0.0.1' } },
    auth: { userId: 'user-123', claims: {}, orgId: queryStringParameters['orgId'] },
  } as unknown as AuthedEvent);

const mockDocument = {
  documentId: 'doc-123',
  projectId: 'proj-123',
  opportunityId: 'opp-123',
  orgId: 'org-123',
  title: 'Test Document',
  documentType: 'TECHNICAL_PROPOSAL',
  deletedAt: undefined,
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

const mockVersion2 = {
  ...mockVersion1,
  versionId: 'ver-2',
  versionNumber: 2,
  htmlContentKey: 'org-123/proj-123/opp-123/rfp-documents/doc-123/versions/v2.html',
  createdAt: '2025-01-02T00:00:00.000Z',
};

describe('compare-versions handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockReset();
    (loadTextFromS3 as jest.Mock).mockReset();
  });

  describe('validation', () => {
    it('returns 400 when orgId is missing', async () => {
      const result = await baseHandler(makeEvent({}));
      expect(result).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('orgId');
    });

    it('returns 400 when fromVersion is missing', async () => {
      const result = await baseHandler(
        makeEvent({
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
          documentId: 'doc-123',
          toVersion: '2',
        }),
      );
      expect(result).toMatchObject({ statusCode: 400 });
    });

    it('returns 400 when toVersion is missing', async () => {
      const result = await baseHandler(
        makeEvent({
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
          documentId: 'doc-123',
          fromVersion: '1',
        }),
      );
      expect(result).toMatchObject({ statusCode: 400 });
    });

    it('returns 400 when version is not a number', async () => {
      const result = await baseHandler(
        makeEvent({
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
          documentId: 'doc-123',
          fromVersion: 'abc',
          toVersion: '2',
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
          fromVersion: '1',
          toVersion: '2',
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
          fromVersion: '1',
          toVersion: '2',
        }),
      );
      expect(result).toMatchObject({ statusCode: 403 });
    });
  });

  describe('version verification', () => {
    it('returns 404 when fromVersion does not exist', async () => {
      // First call: getRFPDocument
      mockSend.mockResolvedValueOnce({ Item: mockDocument });
      // Second call: getVersion for fromVersion - not found
      mockSend.mockResolvedValueOnce({ Item: undefined });
      // Third call: getVersion for toVersion
      mockSend.mockResolvedValueOnce({ Item: mockVersion2 });

      const result = await baseHandler(
        makeEvent({
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
          documentId: 'doc-123',
          fromVersion: '1',
          toVersion: '2',
        }),
      );
      expect(result).toMatchObject({ statusCode: 404 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('Version 1 not found');
    });

    it('returns 404 when toVersion does not exist', async () => {
      // First call: getRFPDocument
      mockSend.mockResolvedValueOnce({ Item: mockDocument });
      // Second call: getVersion for fromVersion
      mockSend.mockResolvedValueOnce({ Item: mockVersion1 });
      // Third call: getVersion for toVersion - not found
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await baseHandler(
        makeEvent({
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
          documentId: 'doc-123',
          fromVersion: '1',
          toVersion: '2',
        }),
      );
      expect(result).toMatchObject({ statusCode: 404 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('Version 2 not found');
    });
  });

  describe('happy path', () => {
    it('returns both versions with HTML content', async () => {
      // First call: getRFPDocument
      mockSend.mockResolvedValueOnce({ Item: mockDocument });
      // Second and third calls: getVersion (parallel)
      mockSend.mockResolvedValueOnce({ Item: mockVersion1 });
      mockSend.mockResolvedValueOnce({ Item: mockVersion2 });

      // S3 loads (parallel)
      (loadTextFromS3 as jest.Mock)
        .mockResolvedValueOnce('<p>Version 1 content</p>')
        .mockResolvedValueOnce('<p>Version 2 content</p>');

      const result = await baseHandler(
        makeEvent({
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
          documentId: 'doc-123',
          fromVersion: '1',
          toVersion: '2',
        }),
      );
      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.fromVersion.versionNumber).toBe(1);
      expect(body.toVersion.versionNumber).toBe(2);
      expect(body.fromHtml).toBe('<p>Version 1 content</p>');
      expect(body.toHtml).toBe('<p>Version 2 content</p>');
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
            fromVersion: '1',
            toVersion: '2',
          }),
        ),
      ).rejects.toThrow('DynamoDB error');
    });

    it('propagates S3 errors', async () => {
      mockSend.mockResolvedValueOnce({ Item: mockDocument });
      mockSend.mockResolvedValueOnce({ Item: mockVersion1 });
      mockSend.mockResolvedValueOnce({ Item: mockVersion2 });
      (loadTextFromS3 as jest.Mock).mockRejectedValue(new Error('S3 error'));

      await expect(
        baseHandler(
          makeEvent({
            orgId: 'org-123',
            projectId: 'proj-123',
            opportunityId: 'opp-123',
            documentId: 'doc-123',
            fromVersion: '1',
            toVersion: '2',
          }),
        ),
      ).rejects.toThrow('S3 error');
    });
  });
});
