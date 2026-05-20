jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (fn: unknown) => fn }));

const mockLoadTextFromS3 = jest.fn();
const mockCopyS3Object = jest.fn();
jest.mock('@/helpers/s3', () => ({
  loadTextFromS3: (...args: unknown[]) => mockLoadTextFromS3(...args),
  copyS3Object: (...args: unknown[]) => mockCopyS3Object(...args),
}));

const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: (...args: unknown[]) => mockInvokeModel(...args),
}));

jest.mock('@/helpers/json', () => ({
  safeParseJsonFromModel: (text: string) => JSON.parse(text),
}));

const mockGetQuestionFile = jest.fn();
const mockCheckCancelled = jest.fn();
jest.mock('@/helpers/questionFile', () => ({
  getQuestionFileItem: (...args: unknown[]) => mockGetQuestionFile(...args),
  checkQuestionFileCancelled: (...args: unknown[]) => mockCheckCancelled(...args),
}));

const mockCreateForm = jest.fn();
const mockListForms = jest.fn();
const mockUpdateForm = jest.fn();
jest.mock('@/helpers/required-form', () => ({
  createRequiredForm: (...args: unknown[]) => mockCreateForm(...args),
  listRequiredFormsByOpportunity: (...args: unknown[]) => mockListForms(...args),
  updateRequiredForm: (...args: unknown[]) => mockUpdateForm(...args),
}));

const mockStartTextract = jest.fn();
jest.mock('@/helpers/textract-forms', () => ({
  startFormsAnalysis: (...args: unknown[]) => mockStartTextract(...args),
}));

const mockParseXlsx = jest.fn();
jest.mock('@/helpers/xlsx-form-parser', () => ({
  parseXlsxForms: (...args: unknown[]) => mockParseXlsx(...args),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'docs-bucket';
process.env.BEDROCK_MODEL_ID = 'anthropic.claude-test';
process.env.BEDROCK_REGION = 'us-east-1';
process.env.TEXTRACT_FORMS_SNS_TOPIC_ARN = 'arn:sns:topic';
process.env.TEXTRACT_FORMS_ROLE_ARN = 'arn:role';

import { baseHandler } from './detect-required-forms';

const encodeModelResponse = (text: string): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text }] }));

const baseEvent = {
  textFileKey: 'org-1/proj-1/opp-1/text.txt',
  sourceFileKey: 'org-1/proj-1/opp-1/file.pdf',
  mimeType: 'application/pdf',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  questionFileId: 'qf-1',
  orgId: 'org-1',
  docType: 'REQUIRED_FORM',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCheckCancelled.mockResolvedValue(false);
  mockListForms.mockResolvedValue([]);
});

describe('detect-required-forms', () => {
  it('skips when docType is not REQUIRED_FORM', async () => {
    const res = await baseHandler({ ...baseEvent, docType: 'INSTRUCTIONS' });
    expect(res).toEqual({ ok: true, formsDetected: 0 });
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('returns cancelled when the question file is cancelled', async () => {
    mockCheckCancelled.mockResolvedValueOnce(true);
    const res = await baseHandler(baseEvent);
    expect(res).toEqual({ ok: true, formsDetected: 0, cancelled: true });
  });

  it('skips when document text is empty', async () => {
    mockLoadTextFromS3.mockResolvedValueOnce('');
    const res = await baseHandler(baseEvent);
    expect(res.formsDetected).toBe(0);
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('skips when the model reports low confidence', async () => {
    mockLoadTextFromS3.mockResolvedValueOnce('document text');
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({ forms: [{ name: 'X', formType: 'PDF_SCANNED' }], confidence: 0.2 })),
    );
    const res = await baseHandler(baseEvent);
    expect(res.formsDetected).toBe(0);
    expect(mockCreateForm).not.toHaveBeenCalled();
  });

  it('creates a form, copies the file, and starts Textract FORMS for a PDF form', async () => {
    mockLoadTextFromS3.mockResolvedValueOnce('document text');
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({
        forms: [{ name: 'Tax Exemption', formType: 'PDF_SCANNED' }],
        confidence: 0.95,
      })),
    );
    mockCreateForm.mockResolvedValueOnce({ formId: 'form-99', item: {} });
    mockStartTextract.mockResolvedValueOnce('job-1');

    const res = await baseHandler(baseEvent);

    expect(res).toEqual({ ok: true, formsDetected: 1 });
    expect(mockCopyS3Object).toHaveBeenCalled();
    expect(mockCreateForm).toHaveBeenCalledWith(expect.objectContaining({
      dto: expect.objectContaining({
        name: 'Tax Exemption',
        formType: 'PDF_SCANNED',
        sourceFileKey: expect.stringContaining('required-forms/'),
      }),
    }));
    expect(mockUpdateForm).toHaveBeenCalledWith(expect.objectContaining({
      formId: 'form-99',
      patch: expect.objectContaining({ status: 'IN_PROGRESS' }),
    }));
    expect(mockStartTextract).toHaveBeenCalledWith(expect.objectContaining({
      jobTag: 'form-99',
      snsTopicArn: 'arn:sns:topic',
      roleArn: 'arn:role',
    }));
  });

  it('marks the form FAILED if startFormsAnalysis throws', async () => {
    mockLoadTextFromS3.mockResolvedValueOnce('document text');
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({
        forms: [{ name: 'Form', formType: 'PDF_SCANNED' }],
        confidence: 0.9,
      })),
    );
    mockCreateForm.mockResolvedValueOnce({ formId: 'form-1', item: {} });
    mockStartTextract.mockRejectedValueOnce(new Error('throttled'));

    await baseHandler(baseEvent);

    expect(mockUpdateForm).toHaveBeenLastCalledWith(expect.objectContaining({
      formId: 'form-1',
      patch: expect.objectContaining({ status: 'FAILED', errorMessage: 'throttled' }),
    }));
  });

  it('parses XLSX inline (no Textract) and writes READY', async () => {
    const xlsxEvent = {
      ...baseEvent,
      sourceFileKey: 'org-1/proj-1/opp-1/file.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    mockLoadTextFromS3.mockResolvedValueOnce('document text');
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({
        forms: [{ name: 'Vendor Q', formType: 'XLSX_FORM' }],
        confidence: 0.9,
      })),
    );
    mockCreateForm.mockResolvedValueOnce({ formId: 'form-x', item: {} });
    mockParseXlsx.mockResolvedValueOnce([{
      fields: [
        { fieldId: 'a', label: 'Name', value: null, status: 'EMPTY' },
        { fieldId: 'b', label: 'Sig', value: null, status: 'MANUAL_REQUIRED' },
      ],
    }]);

    await baseHandler(xlsxEvent);

    expect(mockStartTextract).not.toHaveBeenCalled();
    expect(mockUpdateForm).toHaveBeenCalledWith(expect.objectContaining({
      formId: 'form-x',
      patch: expect.objectContaining({
        status: 'READY',
        totalFieldCount: 2,
        manualFieldCount: 1,
      }),
    }));
  });

  it('skips duplicate forms by case-insensitive name match', async () => {
    mockListForms.mockResolvedValueOnce([{ name: 'Tax Exemption' }]);
    mockLoadTextFromS3.mockResolvedValueOnce('document text');
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({
        forms: [{ name: 'tax exemption', formType: 'PDF_SCANNED' }],
        confidence: 0.95,
      })),
    );

    const res = await baseHandler(baseEvent);

    expect(res.formsDetected).toBe(0);
    expect(mockCreateForm).not.toHaveBeenCalled();
  });
});
