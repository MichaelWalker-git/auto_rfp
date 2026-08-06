jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
}));

const mockS3Send = jest.fn();
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: mockS3Send })),
  GetObjectCommand: jest.fn((params) => ({ type: 'Get', params })),
}));

const mockGetSignedUrl = jest.fn();
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => mockGetSignedUrl(...args),
}));

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (h: unknown) => h,
  TransientServiceError: class extends Error {},
}));

jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: () => ({}),
  orgMembershipMiddleware: () => ({}),
  requirePermission: () => ({}),
  httpErrorMiddleware: () => ({}),
}));

const mockGetForm = jest.fn();
const mockUpdateForm = jest.fn();
jest.mock('@/helpers/required-form', () => ({
  getRequiredForm: (...args: unknown[]) => mockGetForm(...args),
  updateRequiredForm: (...args: unknown[]) => mockUpdateForm(...args),
}));

const mockSyncBridge = jest.fn();
jest.mock('@/helpers/required-form-proposal-bridge', () => ({
  syncFormFilledFileToProposal: (...args: unknown[]) => mockSyncBridge(...args),
}));

const mockFillPdfForm = jest.fn();
jest.mock('@/helpers/pdf-form-filler', () => ({
  fillPdfForm: (...args: unknown[]) => mockFillPdfForm(...args),
}));

const mockFillXlsxForm = jest.fn();
jest.mock('@/helpers/xlsx-form-filler', () => ({
  fillXlsxForm: (...args: unknown[]) => mockFillXlsxForm(...args),
}));

const mockFillDocxForm = jest.fn();
jest.mock('@/helpers/docx-form-filler', () => ({
  fillDocxForm: (...args: unknown[]) => mockFillDocxForm(...args),
}));

jest.mock('@/helpers/api', () => ({
  apiResponse: (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body) }),
  getOrgId: (event: { queryStringParameters?: Record<string, string> }) =>
    event.queryStringParameters?.orgId,
  getUserId: () => 'user-1',
}));

import type { AuthedEvent } from '@/middleware/rbac-middleware';
import { baseHandler } from './export-filled-form';

const queryEvent = (q: Record<string, string>): AuthedEvent =>
  ({ queryStringParameters: q } as unknown as AuthedEvent);

const baseForm = (overrides: Record<string, unknown> = {}) => ({
  formId: 'form-1', orgId: 'org', projectId: 'p', opportunityId: 'o',
  sourceFileKey: 'org/p/o/required-forms/form-1/source.pdf',
  sourceFileName: 'source.pdf',
  fields: [],
  proposalDocumentId: null,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSignedUrl.mockResolvedValue('https://signed.example/url');
});

describe('export-filled-form', () => {
  it('returns 400 when orgId is missing', async () => {
    const res = await baseHandler(queryEvent({ projectId: 'p', opportunityId: 'o', formId: 'f' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 on invalid query parameters', async () => {
    const res = await baseHandler(queryEvent({ orgId: 'org' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when the form is missing', async () => {
    mockGetForm.mockResolvedValueOnce(null);
    const res = await baseHandler(queryEvent({ orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'f' }));
    expect(res.statusCode).toBe(404);
  });

  it('routes PDF source files through fillPdfForm and persists filledFileKey', async () => {
    mockGetForm.mockResolvedValueOnce(baseForm());
    mockFillPdfForm.mockResolvedValueOnce(undefined);
    mockUpdateForm.mockResolvedValueOnce(undefined);

    const res = await baseHandler(queryEvent({ orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'form-1' }));

    expect(res.statusCode).toBe(200);
    expect(mockFillPdfForm).toHaveBeenCalledWith({
      sourceFileKey: 'org/p/o/required-forms/form-1/source.pdf',
      fields: [],
      outputKey: 'org/p/o/required-forms/form-1/filled.pdf',
    });
    expect(mockFillXlsxForm).not.toHaveBeenCalled();
    expect(mockUpdateForm).toHaveBeenCalledWith(expect.objectContaining({
      patch: { filledFileKey: 'org/p/o/required-forms/form-1/filled.pdf' },
    }));
    expect(JSON.parse(res.body as string)).toEqual({
      downloadUrl: 'https://signed.example/url',
      fileName: 'filled_source.pdf',
    });
  });

  it('routes XLSX source files through fillXlsxForm', async () => {
    mockGetForm.mockResolvedValueOnce(baseForm({
      sourceFileKey: 'org/p/o/required-forms/form-1/source.xlsx',
      sourceFileName: 'source.xlsx',
    }));
    mockFillXlsxForm.mockResolvedValueOnce(undefined);
    mockUpdateForm.mockResolvedValueOnce(undefined);

    const res = await baseHandler(queryEvent({ orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'form-1' }));

    expect(res.statusCode).toBe(200);
    expect(mockFillXlsxForm).toHaveBeenCalledWith({
      sourceFileKey: 'org/p/o/required-forms/form-1/source.xlsx',
      fields: [],
      outputKey: 'org/p/o/required-forms/form-1/filled.xlsx',
    });
    expect(mockFillPdfForm).not.toHaveBeenCalled();
  });

  it('also handles legacy .xls source files', async () => {
    mockGetForm.mockResolvedValueOnce(baseForm({
      sourceFileKey: 'src/old.xls',
      sourceFileName: 'old.xls',
    }));
    mockFillXlsxForm.mockResolvedValueOnce(undefined);
    mockUpdateForm.mockResolvedValueOnce(undefined);

    await baseHandler(queryEvent({ orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'form-1' }));
    expect(mockFillXlsxForm).toHaveBeenCalled();
  });

  it('routes DOCX source files through fillDocxForm and persists filledFileKey (TEXT_TOKEN default)', async () => {
    mockGetForm.mockResolvedValueOnce(baseForm({
      sourceFileKey: 'org/p/o/required-forms/form-1/source.docx',
      sourceFileName: 'source.docx',
      name: 'Data Security Addendum',
      // docxFillStrategy omitted → legacy → TEXT_TOKEN default
    }));
    mockFillDocxForm.mockResolvedValueOnce(undefined);
    mockUpdateForm.mockResolvedValueOnce(undefined);

    const res = await baseHandler(queryEvent({ orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'form-1' }));

    expect(res.statusCode).toBe(200);
    expect(mockFillDocxForm).toHaveBeenCalledWith({
      sourceFileKey: 'org/p/o/required-forms/form-1/source.docx',
      fields: [],
      strategy: 'TEXT_TOKEN',
      outputKey: 'org/p/o/required-forms/form-1/filled.docx',
      formName: 'Data Security Addendum',
    });
    expect(mockFillPdfForm).not.toHaveBeenCalled();
    expect(mockUpdateForm).toHaveBeenCalledWith(expect.objectContaining({
      patch: { filledFileKey: 'org/p/o/required-forms/form-1/filled.docx' },
    }));
    expect(JSON.parse(res.body as string)).toEqual({
      downloadUrl: 'https://signed.example/url',
      fileName: 'filled_source.docx',
    });
  });

  it('passes the persisted IN_PLACE strategy through to fillDocxForm', async () => {
    mockGetForm.mockResolvedValueOnce(baseForm({
      sourceFileKey: 'src/form.docx',
      sourceFileName: 'form.docx',
      name: 'Vendor Form',
      docxFillStrategy: 'IN_PLACE',
    }));
    mockFillDocxForm.mockResolvedValueOnce(undefined);
    mockUpdateForm.mockResolvedValueOnce(undefined);

    await baseHandler(queryEvent({ orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'form-1' }));

    expect(mockFillDocxForm).toHaveBeenCalledWith(expect.objectContaining({ strategy: 'IN_PLACE' }));
  });

  it('falls back to a passthrough signed URL for genuinely unsupported file types', async () => {
    mockGetForm.mockResolvedValueOnce(baseForm({
      sourceFileKey: 'src/file.txt',
      sourceFileName: 'file.txt',
    }));

    const res = await baseHandler(queryEvent({ orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'form-1' }));

    expect(res.statusCode).toBe(200);
    expect(mockFillPdfForm).not.toHaveBeenCalled();
    expect(mockFillXlsxForm).not.toHaveBeenCalled();
    expect(mockFillDocxForm).not.toHaveBeenCalled();
    expect(mockUpdateForm).not.toHaveBeenCalled();
    expect(JSON.parse(res.body as string)).toEqual({
      downloadUrl: 'https://signed.example/url',
      fileName: 'file.txt',
    });
  });

  it('syncs the bridge RFP doc fileKey when the form is already attached to the proposal', async () => {
    mockGetForm.mockResolvedValueOnce(baseForm({ proposalDocumentId: 'rfp-doc-1' }));
    mockFillPdfForm.mockResolvedValueOnce(undefined);

    await baseHandler(queryEvent({ orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'form-1' }));

    expect(mockSyncBridge).toHaveBeenCalledWith({
      projectId: 'p',
      opportunityId: 'o',
      proposalDocumentId: 'rfp-doc-1',
      filledFileKey: 'org/p/o/required-forms/form-1/filled.pdf',
      userId: 'user-1',
    });
  });

  it('does NOT sync the bridge when the form has no proposalDocumentId', async () => {
    mockGetForm.mockResolvedValueOnce(baseForm({ proposalDocumentId: null }));
    mockFillPdfForm.mockResolvedValueOnce(undefined);

    await baseHandler(queryEvent({ orgId: 'org', projectId: 'p', opportunityId: 'o', formId: 'form-1' }));

    expect(mockSyncBridge).not.toHaveBeenCalled();
  });
});
