jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

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
  requirePermission: jest.fn(() => ({ before: jest.fn() })),
  httpErrorMiddleware: jest.fn(() => ({ onError: jest.fn() })),
}));

const mockGetItem = jest.fn();
jest.mock('@/helpers/db', () => ({
  getItem: (...args: unknown[]) => mockGetItem(...args),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.DOCUMENTS_BUCKET = 'test-bucket';

import { baseHandler } from './download-document';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

type AuthedEvent = APIGatewayProxyEventV2 & { auth?: { userId?: string } };

const makeEvent = (query: Record<string, string>, userId = 'user-1'): AuthedEvent =>
  ({
    queryStringParameters: query,
    headers: {},
    auth: { userId },
    requestContext: { http: { sourceIp: '127.0.0.1' } },
  } as unknown as AuthedEvent);

describe('download-document', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSignedUrl.mockResolvedValue('https://s3.example.com/presigned-url');
  });

  it('returns 400 when required query parameters are missing', async () => {
    const result = await baseHandler(makeEvent({}));
    expect(result).toMatchObject({ statusCode: 400 });
  });

  it('returns 401 when there is no authenticated user', async () => {
    const result = await baseHandler(makeEvent({ id: 'doc-1', kbId: 'kb-1' }, ''));
    expect(result).toMatchObject({ statusCode: 401 });
  });

  it('returns 404 when the document does not exist', async () => {
    mockGetItem.mockResolvedValue(null);

    const result = await baseHandler(makeEvent({ id: 'doc-1', kbId: 'kb-1' }));
    expect(result).toMatchObject({ statusCode: 404 });
  });

  it('returns 404 when the document has no file key', async () => {
    mockGetItem.mockResolvedValue({ id: 'doc-1', name: 'Report.pdf' });

    const result = await baseHandler(makeEvent({ id: 'doc-1', kbId: 'kb-1' }));
    expect(result).toMatchObject({ statusCode: 404 });
  });

  it('returns a presigned URL with an attachment Content-Disposition reflecting the current DDB name', async () => {
    mockGetItem.mockResolvedValue({
      id: 'doc-1',
      name: 'Technical Proposal.pdf',
      fileKey: 'org/kb/doc-1.pdf',
    });

    const result = await baseHandler(makeEvent({ id: 'doc-1', kbId: 'kb-1' }));

    expect(result).toMatchObject({ statusCode: 200 });
    const body = JSON.parse((result as { body: string }).body);
    expect(body.url).toBe('https://s3.example.com/presigned-url');
    expect(body.fileName).toBe('Technical Proposal.pdf');

    expect(GetObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: 'test-bucket',
        Key: 'org/kb/doc-1.pdf',
        ResponseContentDisposition: 'attachment; filename="Technical Proposal.pdf"; filename*=UTF-8\'\'Technical%20Proposal.pdf',
      }),
    );
  });

  it('includes an RFC-5987 encoded filename* for non-ASCII document names', async () => {
    mockGetItem.mockResolvedValue({
      id: 'doc-1',
      name: 'Café Proposal.pdf',
      fileKey: 'org/kb/doc-1.pdf',
    });

    await baseHandler(makeEvent({ id: 'doc-1', kbId: 'kb-1' }));

    expect(GetObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        ResponseContentDisposition: expect.stringContaining("filename*=UTF-8''Caf%C3%A9%20Proposal.pdf"),
      }),
    );
    expect(GetObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        ResponseContentDisposition: expect.stringContaining('filename="Caf_ Proposal.pdf"'),
      }),
    );
  });

  it('reflects a renamed document on the next download', async () => {
    mockGetItem.mockResolvedValue({
      id: 'doc-1',
      name: 'Renamed Document.pdf',
      fileKey: 'org/kb/doc-1.pdf',
    });

    const result = await baseHandler(makeEvent({ id: 'doc-1', kbId: 'kb-1' }));
    const body = JSON.parse((result as { body: string }).body);

    expect(body.fileName).toBe('Renamed Document.pdf');
    expect(GetObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        ResponseContentDisposition: expect.stringContaining('filename="Renamed Document.pdf"'),
      }),
    );
  });
});
