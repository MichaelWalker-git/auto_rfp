process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (h: unknown) => h }));
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: () => ({}),
  setAuditContext: jest.fn(),
}));
jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({}),
  orgMembershipMiddleware: () => ({}),
  requirePermission: () => ({}),
  httpErrorMiddleware: () => ({}),
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
  GetCommand: jest.fn((p) => ({ type: 'Get', params: p })),
  UpdateCommand: jest.fn((p) => ({ type: 'Update', params: p })),
}));

jest.mock('@/helpers/api', () => ({
  apiResponse: (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body) }),
  getUserId: () => 'user-1',
}));

const mockGetRequest = jest.fn();
const mockUpdateFields = jest.fn();
jest.mock('@/helpers/foia', () => ({
  getFoiaRequest: (...a: unknown[]) => mockGetRequest(...a),
  updateFoiaRequestFields: (...a: unknown[]) => mockUpdateFields(...a),
}));

import { baseHandler } from './add-foia-response-document';

const document = {
  s3Key: 'org-1/proj-1/opp-1/foia/foia-1/response/ssdd.pdf',
  fileName: 'ssdd.pdf',
  contentType: 'application/pdf',
  sizeBytes: 12345,
};

const event = (over: Record<string, unknown> = {}) =>
  ({
    body: JSON.stringify({
      orgId: 'org-1',
      projectId: 'proj-1',
      oppId: 'opp-1',
      foiaRequestId: 'foia-1',
      document,
      ...over,
    }),
    requestContext: { http: { sourceIp: '1.2.3.4' } },
    headers: {},
  }) as never;

const parse = (res: { body: string }) => JSON.parse(res.body);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetRequest.mockResolvedValue({ foiaId: 'foia-1', responseDocuments: undefined });
  mockUpdateFields.mockImplementation((_o, _p, _x, _f, patch) => Promise.resolve({ foiaId: 'foia-1', ...patch }));
});

describe('add-foia-response-document', () => {
  it('appends the document and stamps who uploaded it', async () => {
    const res = (await baseHandler(event())) as { statusCode: number; body: string };

    expect(res.statusCode).toBe(201);
    const [, , , , patch] = mockUpdateFields.mock.calls[0]! as [
      string, string, string, string, { responseDocuments: Array<Record<string, unknown>> },
    ];
    expect(patch.responseDocuments).toHaveLength(1);
    expect(patch.responseDocuments[0]).toMatchObject({
      s3Key: document.s3Key,
      fileName: 'ssdd.pdf',
      uploadedBy: 'user-1',
    });
    expect(patch.responseDocuments[0]!.uploadedAt).toBeTruthy();
  });

  it('stamps responseReceivedAt on the first document only', async () => {
    await baseHandler(event());

    const [, , , , first] = mockUpdateFields.mock.calls[0]! as [
      string, string, string, string, Record<string, unknown>,
    ];
    expect(first.responseReceivedAt).toBeTruthy();

    // A second upload must not move the response date.
    mockUpdateFields.mockClear();
    mockGetRequest.mockResolvedValue({
      foiaId: 'foia-1',
      responseReceivedAt: '2026-01-01T00:00:00.000Z',
      responseDocuments: [{ ...document, s3Key: 'other.pdf', uploadedAt: 'x', uploadedBy: 'y' }],
    });

    await baseHandler(event());

    const [, , , , second] = mockUpdateFields.mock.calls[0]! as [
      string, string, string, string, Record<string, unknown>,
    ];
    expect(second.responseReceivedAt).toBeUndefined();
  });

  it('preserves existing documents rather than replacing them', async () => {
    mockGetRequest.mockResolvedValue({
      foiaId: 'foia-1',
      responseDocuments: [
        { s3Key: 'first.pdf', fileName: 'first.pdf', contentType: 'application/pdf', uploadedAt: 'x', uploadedBy: 'y' },
      ],
    });

    await baseHandler(event());

    const [, , , , patch] = mockUpdateFields.mock.calls[0]! as [
      string, string, string, string, { responseDocuments: Array<{ s3Key: string }> },
    ];
    expect(patch.responseDocuments.map((d) => d.s3Key)).toEqual(['first.pdf', document.s3Key]);
  });

  it('is idempotent on the same s3Key, so a double submit does not duplicate', async () => {
    mockGetRequest.mockResolvedValue({
      foiaId: 'foia-1',
      responseDocuments: [{ ...document, uploadedAt: 'x', uploadedBy: 'y' }],
    });

    const res = (await baseHandler(event())) as { statusCode: number; body: string };

    expect(res.statusCode).toBe(200);
    expect(parse(res).alreadyRecorded).toBe(true);
    expect(mockUpdateFields).not.toHaveBeenCalled();
  });

  it('404s when the FOIA request does not exist', async () => {
    mockGetRequest.mockResolvedValue(null);

    const res = (await baseHandler(event())) as { statusCode: number };

    expect(res.statusCode).toBe(404);
    expect(mockUpdateFields).not.toHaveBeenCalled();
  });

  it('400s on a missing s3Key', async () => {
    const res = (await baseHandler(
      event({ document: { fileName: 'a.pdf', contentType: 'application/pdf' } }),
    )) as { statusCode: number };

    expect(res.statusCode).toBe(400);
  });

  it('400s on an unknown documentType', async () => {
    const res = (await baseHandler(
      event({ document: { ...document, documentType: 'NOT_A_TYPE' } }),
    )) as { statusCode: number };

    expect(res.statusCode).toBe(400);
  });

  it('accepts a valid documentType', async () => {
    const res = (await baseHandler(
      event({ document: { ...document, documentType: 'SSDD' } }),
    )) as { statusCode: number };

    expect(res.statusCode).toBe(201);
  });

  it('400s on a missing identifier', async () => {
    const res = (await baseHandler(event({ foiaRequestId: '' }))) as { statusCode: number };

    expect(res.statusCode).toBe(400);
  });
});
