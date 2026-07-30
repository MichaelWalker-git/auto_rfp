jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
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

const mockStartTextract = jest.fn();
jest.mock('@/helpers/textract-forms', () => ({
  startFormsAnalysis: (...args: unknown[]) => mockStartTextract(...args),
}));

const mockGetFileFromS3 = jest.fn();
jest.mock('@/helpers/s3', () => ({
  getFileFromS3: (...args: unknown[]) => mockGetFileFromS3(...args),
}));

const mockExtractDocx = jest.fn();
jest.mock('@/helpers/docx-form-parser', () => ({
  extractAndAutofillDocxForm: (...args: unknown[]) => mockExtractDocx(...args),
}));

const mockMammoth = jest.fn();
jest.mock('mammoth', () => ({
  __esModule: true,
  default: { extractRawText: (...args: unknown[]) => mockMammoth(...args) },
}));

jest.mock('@/helpers/api', () => ({
  apiResponse: (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body) }),
  getOrgId: (event: { queryStringParameters?: Record<string, string> }) =>
    event.queryStringParameters?.orgId,
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.DOCUMENTS_BUCKET = 'docs-bucket';
process.env.TEXTRACT_FORMS_SNS_TOPIC_ARN = 'arn:sns:topic';
process.env.TEXTRACT_FORMS_ROLE_ARN = 'arn:role';

import type { APIGatewayProxyEventV2 } from 'aws-lambda';

// Re-import after mocks
import * as mod from './reprocess-form';
const baseHandler = (mod as { handler: { handler: (event: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }> } }).handler.handler;

const formStub = {
  formId: 'form-1',
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  sourceFileKey: 'org-1/proj-1/opp-1/required-forms/form-1/file.pdf',
};

const event = (q: Record<string, string>): APIGatewayProxyEventV2 =>
  ({ queryStringParameters: q } as unknown as APIGatewayProxyEventV2);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('reprocess-form', () => {
  it('returns 400 when orgId is missing', async () => {
    const res = await baseHandler(event({ projectId: 'p', opportunityId: 'o', formId: 'f' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when query params are invalid', async () => {
    const res = await baseHandler(event({ orgId: 'org-1' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when form is not found', async () => {
    mockGetForm.mockResolvedValueOnce(null);
    const res = await baseHandler(event({ orgId: 'org-1', projectId: 'p', opportunityId: 'o', formId: 'f' }));
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when the form is neither PDF nor Word', async () => {
    mockGetForm.mockResolvedValueOnce({ ...formStub, sourceFileKey: 'foo/bar.xlsx' });
    const res = await baseHandler(event({
      orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1', formId: 'form-1',
    }));
    expect(res.statusCode).toBe(400);
  });

  it('reprocesses a DOCX form synchronously and returns 200 READY', async () => {
    mockGetForm.mockResolvedValueOnce({ ...formStub, sourceFileKey: 'org-1/proj-1/opp-1/required-forms/form-1/rfp.docx' });
    mockUpdateForm.mockResolvedValue(formStub);
    mockGetFileFromS3.mockResolvedValueOnce([Buffer.from('docx bytes')]);
    mockMammoth.mockResolvedValueOnce({ value: 'Company Name: ___' });
    mockExtractDocx.mockResolvedValueOnce({
      fields: [{ fieldId: 'a', label: 'Company Name', status: 'AUTO_FILLED', value: 'Acme' }],
      totalFieldCount: 1, manualFieldCount: 0, autoFillPercentage: 100,
    });

    const res = await baseHandler(event({
      orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1', formId: 'form-1',
    }));

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, status: 'READY', totalFieldCount: 1 });
    expect(mockStartTextract).not.toHaveBeenCalled();
    expect(mockExtractDocx).toHaveBeenCalledWith('Company Name: ___', 'org-1');
    const readyCall = mockUpdateForm.mock.calls.find((c) => (c[0] as { patch?: { status?: string } }).patch?.status === 'READY');
    expect(readyCall).toBeDefined();
  });

  it('marks a DOCX form FAILED when the source file exceeds the size limit', async () => {
    mockGetForm.mockResolvedValueOnce({ ...formStub, sourceFileKey: 'org-1/proj-1/opp-1/required-forms/form-1/huge.docx' });
    mockUpdateForm.mockResolvedValue(formStub);
    // Stream a single chunk larger than the 25MB cap; streamToBuffer must abort
    // before buffering it all and never reach mammoth/extraction.
    mockGetFileFromS3.mockResolvedValueOnce([Buffer.alloc(26 * 1024 * 1024)]);

    const res = await baseHandler(event({
      orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1', formId: 'form-1',
    }));

    expect(res.statusCode).toBe(500);
    expect(mockMammoth).not.toHaveBeenCalled();
    expect(mockExtractDocx).not.toHaveBeenCalled();
    expect(mockUpdateForm).toHaveBeenLastCalledWith(expect.objectContaining({
      patch: expect.objectContaining({ status: 'FAILED', errorMessage: expect.stringContaining('exceeds') }),
    }));
  });

  it('marks a DOCX form FAILED and returns 500 if extraction throws', async () => {
    mockGetForm.mockResolvedValueOnce({ ...formStub, sourceFileKey: 'org-1/proj-1/opp-1/required-forms/form-1/rfp.docx' });
    mockUpdateForm.mockResolvedValue(formStub);
    mockGetFileFromS3.mockResolvedValueOnce([Buffer.from('docx bytes')]);
    mockMammoth.mockResolvedValueOnce({ value: 'text' });
    mockExtractDocx.mockRejectedValueOnce(new Error('bedrock down'));

    const res = await baseHandler(event({
      orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1', formId: 'form-1',
    }));

    expect(res.statusCode).toBe(500);
    expect(mockUpdateForm).toHaveBeenLastCalledWith(expect.objectContaining({
      patch: expect.objectContaining({ status: 'FAILED', errorMessage: 'bedrock down' }),
    }));
  });

  it('starts Textract FORMS analysis and returns 202 on success', async () => {
    mockGetForm.mockResolvedValueOnce(formStub);
    mockUpdateForm.mockResolvedValue(formStub);
    mockStartTextract.mockResolvedValueOnce('job-99');

    const res = await baseHandler(event({
      orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1', formId: 'form-1',
    }));

    expect(res.statusCode).toBe(202);
    expect(JSON.parse(res.body)).toMatchObject({ ok: true, jobId: 'job-99', status: 'IN_PROGRESS' });
    expect(mockUpdateForm).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({ status: 'IN_PROGRESS' }),
    }));
    expect(mockStartTextract).toHaveBeenCalledWith({
      bucket: 'docs-bucket',
      fileKey: formStub.sourceFileKey,
      jobTag: 'form-1',
      snsTopicArn: 'arn:sns:topic',
      roleArn: 'arn:role',
    });
  });

  it('marks the form FAILED and returns 500 if Textract refuses to start', async () => {
    mockGetForm.mockResolvedValueOnce(formStub);
    mockUpdateForm.mockResolvedValue(formStub);
    mockStartTextract.mockRejectedValueOnce(new Error('access denied'));

    const res = await baseHandler(event({
      orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1', formId: 'form-1',
    }));

    expect(res.statusCode).toBe(500);
    expect(mockUpdateForm).toHaveBeenLastCalledWith(expect.objectContaining({
      patch: expect.objectContaining({ status: 'FAILED', errorMessage: 'access denied' }),
    }));
  });
});
