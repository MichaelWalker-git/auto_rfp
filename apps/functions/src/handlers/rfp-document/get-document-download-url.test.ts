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

const mockGetSignedUrl = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn() })),
  GetObjectCommand: jest.fn((params) => ({ type: 'GetObject', params })),
}));
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: jest.fn(() => ({ before: jest.fn() })),
  orgMembershipMiddleware: jest.fn(() => ({ before: jest.fn() })),
  httpErrorMiddleware: jest.fn(() => ({ onError: jest.fn() })),
}));

const mockGetRFPDocument = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  getRFPDocument: (...args: unknown[]) => mockGetRFPDocument(...args),
}));

process.env['DB_TABLE_NAME'] = 'test-table';
process.env['REGION'] = 'us-east-1';
process.env['DOCUMENTS_BUCKET'] = 'test-bucket';

import { baseHandler } from './get-document-download-url';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

const TEST_IDS = {
  ORG_ID: '11111111-1111-4111-8111-111111111111',
  PROJECT_ID: '22222222-2222-4222-8222-222222222222',
  OPPORTUNITY_ID: '33333333-3333-4333-8333-333333333333',
  DOCUMENT_ID: '44444444-4444-4444-8444-444444444444',
};

const makeEvent = (body: Record<string, unknown>): APIGatewayProxyEventV2 =>
  ({
    body: JSON.stringify(body),
    headers: { 'x-org-id': TEST_IDS.ORG_ID },
    queryStringParameters: { orgId: TEST_IDS.ORG_ID },
    requestContext: { http: { sourceIp: '127.0.0.1' } },
  } as unknown as APIGatewayProxyEventV2);

describe('get-document-download-url', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSignedUrl.mockResolvedValue('https://s3.example.com/presigned-url');
  });

  it('returns 400 when orgId is missing', async () => {
    const event = {
      body: JSON.stringify({ projectId: 'p', opportunityId: 'o', documentId: 'd' }),
      headers: {},
      queryStringParameters: {},
      requestContext: { http: { sourceIp: '127.0.0.1' } },
    } as unknown as APIGatewayProxyEventV2;

    const result = await baseHandler(event);
    expect(result).toMatchObject({ statusCode: 400 });
  });

  it('returns 400 when required fields are missing', async () => {
    const result = await baseHandler(makeEvent({}));
    expect(result).toMatchObject({ statusCode: 400 });
    const body = JSON.parse((result as { body: string }).body);
    expect(body.message).toContain('required');
  });

  it('returns 404 when document not found', async () => {
    mockGetRFPDocument.mockResolvedValue(null);

    const result = await baseHandler(makeEvent({
      projectId: TEST_IDS.PROJECT_ID,
      opportunityId: TEST_IDS.OPPORTUNITY_ID,
      documentId: TEST_IDS.DOCUMENT_ID,
    }));
    expect(result).toMatchObject({ statusCode: 404 });
  });

  it('returns 403 when orgId does not match', async () => {
    mockGetRFPDocument.mockResolvedValue({
      orgId: 'different-org',
      fileKey: 'some/key.docx',
      name: 'file.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    const result = await baseHandler(makeEvent({
      projectId: TEST_IDS.PROJECT_ID,
      opportunityId: TEST_IDS.OPPORTUNITY_ID,
      documentId: TEST_IDS.DOCUMENT_ID,
    }));
    expect(result).toMatchObject({ statusCode: 403 });
  });

  it('returns presigned URL with ResponseContentDisposition attachment header', async () => {
    mockGetRFPDocument.mockResolvedValue({
      orgId: TEST_IDS.ORG_ID,
      fileKey: 'org/proj/doc.docx',
      name: 'Technical Proposal.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    const result = await baseHandler(makeEvent({
      projectId: TEST_IDS.PROJECT_ID,
      opportunityId: TEST_IDS.OPPORTUNITY_ID,
      documentId: TEST_IDS.DOCUMENT_ID,
    }));

    expect(result).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((result as { body: string }).body);
    expect(body.url).toBe('https://s3.example.com/presigned-url');

    // Verify GetObjectCommand was called with ResponseContentDisposition
    expect(GetObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'test-bucket',
        Key: 'org/proj/doc.docx',
        ResponseContentDisposition: expect.stringContaining('attachment'),
      }),
    );
  });

  it('sanitizes special characters in filename for Content-Disposition', async () => {
    mockGetRFPDocument.mockResolvedValue({
      orgId: TEST_IDS.ORG_ID,
      fileKey: 'org/proj/doc.docx',
      name: 'Proposal (Draft #1) — Final.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    await baseHandler(makeEvent({
      projectId: TEST_IDS.PROJECT_ID,
      opportunityId: TEST_IDS.OPPORTUNITY_ID,
      documentId: TEST_IDS.DOCUMENT_ID,
    }));

    // The filename should be sanitized — no parentheses, hash, em-dash, or spaces
    expect(GetObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        ResponseContentDisposition: 'attachment; filename="Proposal__Draft__1____Final.docx"',
      }),
    );
  });

  it('returns 404 for soft-deleted documents', async () => {
    mockGetRFPDocument.mockResolvedValue({
      orgId: TEST_IDS.ORG_ID,
      fileKey: 'key',
      name: 'deleted.pdf',
      mimeType: 'application/pdf',
      deletedAt: '2025-01-01T00:00:00Z',
    });

    const result = await baseHandler(makeEvent({
      projectId: TEST_IDS.PROJECT_ID,
      opportunityId: TEST_IDS.OPPORTUNITY_ID,
      documentId: TEST_IDS.DOCUMENT_ID,
    }));
    expect(result).toMatchObject({ statusCode: 404 });
  });
});
