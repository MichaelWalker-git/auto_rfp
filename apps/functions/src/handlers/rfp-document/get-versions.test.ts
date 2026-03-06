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

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: jest.fn(() => ({ before: jest.fn() })),
  orgMembershipMiddleware: jest.fn(() => ({ before: jest.fn() })),
  requirePermission: jest.fn(() => ({ before: jest.fn() })),
  httpErrorMiddleware: jest.fn(() => ({ onError: jest.fn() })),
}));

// Set required environment variables
process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';
process.env['DOCUMENTS_BUCKET'] = 'test-bucket';

import { baseHandler } from './get-versions';
import type { AuthedEvent } from '@/middleware/rbac-middleware';

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

const mockVersion = {
  versionId: 'ver-123',
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

describe('get-versions handler', () => {
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

    it('returns 400 when projectId is missing', async () => {
      const result = await baseHandler(makeEvent({ orgId: 'org-123' }));
      expect(result).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('projectId');
    });

    it('returns 400 when opportunityId is missing', async () => {
      const result = await baseHandler(makeEvent({ orgId: 'org-123', projectId: 'proj-123' }));
      expect(result).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('opportunityId');
    });

    it('returns 400 when documentId is missing', async () => {
      const result = await baseHandler(
        makeEvent({ orgId: 'org-123', projectId: 'proj-123', opportunityId: 'opp-123' }),
      );
      expect(result).toMatchObject({ statusCode: 400 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toContain('documentId');
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
        }),
      );
      expect(result).toMatchObject({ statusCode: 404 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toBe('Document not found');
    });

    it('returns 404 when document is deleted', async () => {
      mockSend.mockResolvedValueOnce({
        Item: { ...mockDocument, deletedAt: '2025-01-01T00:00:00Z' },
      });

      const result = await baseHandler(
        makeEvent({
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
          documentId: 'doc-123',
        }),
      );
      expect(result).toMatchObject({ statusCode: 404 });
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
        }),
      );
      expect(result).toMatchObject({ statusCode: 403 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.message).toBe('Access denied');
    });
  });

  describe('happy path', () => {
    it('returns empty list when no versions exist', async () => {
      // First call: getRFPDocument
      mockSend.mockResolvedValueOnce({ Item: mockDocument });
      // Second call: listVersions (query)
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await baseHandler(
        makeEvent({
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
          documentId: 'doc-123',
        }),
      );
      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.items).toEqual([]);
      expect(body.count).toBe(0);
    });

    it('returns versions sorted by version number descending', async () => {
      const version2 = { ...mockVersion, versionId: 'ver-456', versionNumber: 2 };

      // First call: getRFPDocument
      mockSend.mockResolvedValueOnce({ Item: mockDocument });
      // Second call: listVersions (query)
      mockSend.mockResolvedValueOnce({ Items: [mockVersion, version2] });

      const result = await baseHandler(
        makeEvent({
          orgId: 'org-123',
          projectId: 'proj-123',
          opportunityId: 'opp-123',
          documentId: 'doc-123',
        }),
      );
      expect(result).toMatchObject({ statusCode: 200 });
      const body = JSON.parse((result as { body: string }).body);
      expect(body.items).toHaveLength(2);
      expect(body.count).toBe(2);
      // Sorted descending
      expect(body.items[0].versionNumber).toBe(2);
      expect(body.items[1].versionNumber).toBe(1);
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
          }),
        ),
      ).rejects.toThrow('DynamoDB error');
    });
  });
});
