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

jest.mock('@/helpers/api', () => ({
  apiResponse: (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body) }),
  getOrgId: (event: { queryStringParameters?: Record<string, string> }) => event.queryStringParameters?.orgId,
}));

const mockGetForm = jest.fn();
jest.mock('@/helpers/required-form', () => ({
  getRequiredForm: (...args: unknown[]) => mockGetForm(...args),
}));

const mockGetProfile = jest.fn();
jest.mock('@/helpers/company-profile', () => ({
  getCompanyProfile: (...args: unknown[]) => mockGetProfile(...args),
}));

const mockGatherContext = jest.fn();
jest.mock('@/helpers/document-context', () => ({
  gatherAllContext: (...args: unknown[]) => mockGatherContext(...args),
}));

const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: (...args: unknown[]) => mockInvokeModel(...args),
}));

jest.mock('@/helpers/json', () => ({
  safeParseJsonFromModel: (text: string) => JSON.parse(text),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.BEDROCK_MODEL_ID = 'anthropic.claude-test';

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import * as mod from './ai-fill-field';

const baseHandler = (mod as { handler: { handler: (event: APIGatewayProxyEventV2) => Promise<{ statusCode: number; body: string }> } }).handler.handler;

const event = (body: Record<string, unknown>, query: Record<string, string> = { orgId: 'org-1' }): APIGatewayProxyEventV2 =>
  ({ body: JSON.stringify(body), queryStringParameters: query } as unknown as APIGatewayProxyEventV2);

const formStub = {
  formId: 'form-1',
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  name: 'Tax Exemption',
  fields: [
    { fieldId: 'f-1', label: 'Company Name', value: null, status: 'EMPTY' },
  ],
};

const validBody = { projectId: 'proj-1', opportunityId: 'opp-1', formId: 'form-1', fieldId: 'f-1' };

const encodeModelResponse = (text: string): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text }] }));

beforeEach(() => {
  jest.clearAllMocks();
  mockGatherContext.mockResolvedValue('Some KB context here');
});

describe('ai-fill-field', () => {
  it('returns 400 when orgId is missing', async () => {
    const res = await baseHandler(event(validBody, {}));
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 when body is invalid', async () => {
    const res = await baseHandler(event({ projectId: 'p' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when form is not found', async () => {
    mockGetForm.mockResolvedValueOnce(null);
    const res = await baseHandler(event(validBody));
    expect(res.statusCode).toBe(404);
  });

  it('returns 404 when fieldId is not on the form', async () => {
    mockGetForm.mockResolvedValueOnce({ ...formStub, fields: [] });
    const res = await baseHandler(event(validBody));
    expect(res.statusCode).toBe(404);
  });

  it('returns null value when no profile is configured', async () => {
    mockGetForm.mockResolvedValueOnce(formStub);
    mockGetProfile.mockResolvedValueOnce(null);

    const res = await baseHandler(event(validBody));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ value: null, confidence: 0, reason: expect.stringMatching(/profile/i) });
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('returns the model output when Bedrock returns a high-confidence value', async () => {
    mockGetForm.mockResolvedValueOnce(formStub);
    mockGetProfile.mockResolvedValueOnce({ orgId: 'org-1', companyName: 'Acme Corp' });
    mockInvokeModel.mockResolvedValueOnce(encodeModelResponse(JSON.stringify({
      value: 'Acme Corp', source: 'companyName', confidence: 0.95, reason: '',
    })));

    const res = await baseHandler(event(validBody));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ value: 'Acme Corp', source: 'companyName', confidence: 0.95 });
    // orgId propagates to invokeModel as the third argument (per-org Bedrock key).
    expect(mockInvokeModel).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'org-1',
    );
  });

  it('falls back to a friendly response when AI returns malformed JSON', async () => {
    mockGetForm.mockResolvedValueOnce(formStub);
    mockGetProfile.mockResolvedValueOnce({ orgId: 'org-1', companyName: 'Acme Corp' });
    mockInvokeModel.mockResolvedValueOnce(encodeModelResponse('{ broken json'));

    const res = await baseHandler(event(validBody));
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toMatchObject({ value: null, confidence: 0 });
  });

  it('returns 502 when Bedrock call throws', async () => {
    mockGetForm.mockResolvedValueOnce(formStub);
    mockGetProfile.mockResolvedValueOnce({ orgId: 'org-1', companyName: 'Acme Corp' });
    mockInvokeModel.mockRejectedValueOnce(new Error('throttled'));

    const res = await baseHandler(event(validBody));
    expect(res.statusCode).toBe(502);
  });

  it('uses labelOverride when provided, even if the fieldId is not yet on the form (locally-created field)', async () => {
    mockGetForm.mockResolvedValueOnce({ ...formStub, fields: [] });
    mockGetProfile.mockResolvedValueOnce({ orgId: 'org-1', companyName: 'Acme Corp' });
    mockInvokeModel.mockResolvedValueOnce(encodeModelResponse(JSON.stringify({
      value: 'Acme Corp', source: 'companyName', confidence: 0.9,
    })));

    const res = await baseHandler(event({ ...validBody, labelOverride: 'Consultant Entity Name' }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ value: 'Acme Corp', confidence: 0.9 });
    // The label sent to the KB context loader should be the override
    expect(mockGatherContext).toHaveBeenCalledWith(expect.objectContaining({ solicitation: 'Consultant Entity Name' }));
  });

  it('still completes when KB context lookup fails (graceful degradation)', async () => {
    mockGetForm.mockResolvedValueOnce(formStub);
    mockGetProfile.mockResolvedValueOnce({ orgId: 'org-1', companyName: 'Acme Corp' });
    mockGatherContext.mockRejectedValueOnce(new Error('pinecone down'));
    mockInvokeModel.mockResolvedValueOnce(encodeModelResponse(JSON.stringify({
      value: 'Acme Corp', source: 'companyName', confidence: 0.9,
    })));

    const res = await baseHandler(event(validBody));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).value).toBe('Acme Corp');
  });
});
