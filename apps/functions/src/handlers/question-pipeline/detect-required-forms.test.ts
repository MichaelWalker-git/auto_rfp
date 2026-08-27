jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@/sentry-lambda', () => ({ withSentryLambda: (fn: unknown) => fn }));

const mockLoadTextFromS3 = jest.fn();
const mockCopyS3Object = jest.fn();
const mockGetFileBufferFromS3 = jest.fn();
jest.mock('@/helpers/s3', () => ({
  loadTextFromS3: (...args: unknown[]) => mockLoadTextFromS3(...args),
  copyS3Object: (...args: unknown[]) => mockCopyS3Object(...args),
  getFileBufferFromS3: (...args: unknown[]) => mockGetFileBufferFromS3(...args),
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
const mockUpdateQuestionFile = jest.fn();
jest.mock('@/helpers/questionFile', () => ({
  getQuestionFileItem: (...args: unknown[]) => mockGetQuestionFile(...args),
  checkQuestionFileCancelled: (...args: unknown[]) => mockCheckCancelled(...args),
  updateQuestionFile: (...args: unknown[]) => mockUpdateQuestionFile(...args),
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

const mockAutofillMatrix = jest.fn();
jest.mock('@/helpers/matrix-autofill', () => ({
  autofillMatrixComments: (...args: unknown[]) => mockAutofillMatrix(...args),
}));

const mockExtractDocx = jest.fn();
jest.mock('@/helpers/docx-form-parser', () => ({
  extractAndAutofillDocxForm: (...args: unknown[]) => mockExtractDocx(...args),
}));

const mockMarkFormsReady = jest.fn();
jest.mock('@/helpers/mark-forms-ready', () => ({
  markFormsReadyIfAllDone: (...args: unknown[]) => mockMarkFormsReady(...args),
}));

// WF-A body notary scan — mocked so the detection handler tests stay focused on
// form detection; the scan's own behaviour is covered in notary-wiring.test.ts.
const mockRunBodyNotaryScan = jest.fn();
const mockRollupNotary = jest.fn();
jest.mock('@/helpers/notary-wiring', () => ({
  runBodyNotaryScanAndPersist: (...args: unknown[]) => mockRunBodyNotaryScan(...args),
  rollupOpportunityNotary: (...args: unknown[]) => mockRollupNotary(...args),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.DOCUMENTS_BUCKET = 'docs-bucket';
process.env.BEDROCK_MODEL_ID = 'anthropic.claude-test';
process.env.DETECTION_MODEL_ID = 'anthropic.claude-haiku-test';
process.env.BEDROCK_REGION = 'us-east-1';
process.env.TEXTRACT_FORMS_SNS_TOPIC_ARN = 'arn:sns:topic';
process.env.TEXTRACT_FORMS_ROLE_ARN = 'arn:role';

import { baseHandler } from './detect-required-forms';

const encodeModelResponse = (text: string): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text }] }));

type DetectedFormResultLike = { name: string; formType: string; pageRange?: string; sheetName?: string };

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
  mockUpdateQuestionFile.mockResolvedValue({ success: true });
  mockMarkFormsReady.mockResolvedValue(undefined);
  mockRunBodyNotaryScan.mockResolvedValue([]);
  mockRollupNotary.mockResolvedValue(undefined);
  // DOCX branch fetches the raw bytes for structure detection.
  mockGetFileBufferFromS3.mockResolvedValue(Buffer.from('docx bytes'));
});

describe('detect-required-forms', () => {
  it('skips only when docType is QUESTIONNAIRE', async () => {
    const res = await baseHandler({ ...baseEvent, docType: 'QUESTIONNAIRE' });
    expect(res).toEqual({ ok: true, formsDetected: 0 });
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('runs detection on OTHER documents (does not gate on REQUIRED_FORM)', async () => {
    mockLoadTextFromS3.mockResolvedValueOnce('document text');
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({ forms: [], confidence: 1.0 })),
    );
    const res = await baseHandler({ ...baseEvent, docType: 'OTHER' });
    expect(mockInvokeModel).toHaveBeenCalledTimes(1);
    expect(res.formsDetected).toBe(0);
  });

  it('runs the scan on DETECTION_MODEL_ID (independent of the autofill BEDROCK_MODEL_ID)', async () => {
    mockLoadTextFromS3.mockResolvedValueOnce('document text');
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({ forms: [], confidence: 1.0 })),
    );
    await baseHandler({ ...baseEvent, docType: 'OTHER' });
    // The whole-document scan must run on DETECTION_MODEL_ID (set to a distinct value
    // in this suite), never the autofill BEDROCK_MODEL_ID — so the two model tiers
    // stay independently tunable.
    expect(mockInvokeModel).toHaveBeenCalledWith('anthropic.claude-haiku-test', expect.any(String));
    expect(mockInvokeModel).not.toHaveBeenCalledWith('anthropic.claude-test', expect.any(String));
  });

  it('runs detection when docType is missing', async () => {
    mockLoadTextFromS3.mockResolvedValueOnce('document text');
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({ forms: [], confidence: 1.0 })),
    );
    const { docType: _omit, ...noDocType } = baseEvent;
    const res = await baseHandler(noDocType);
    expect(mockInvokeModel).toHaveBeenCalledTimes(1);
    expect(res.formsDetected).toBe(0);
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
    // No forms created → don't touch the question file status or run the readiness
    // check (which would spuriously flip other files to FORMS_READY).
    expect(mockMarkFormsReady).not.toHaveBeenCalled();
    expect(mockUpdateQuestionFile).not.toHaveBeenCalled();
  });

  it('does not run the FORMS_READY check for a PDF form (async Textract path owns that)', async () => {
    mockLoadTextFromS3.mockResolvedValueOnce('document text');
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({
        forms: [{ name: 'PDF Cert', formType: 'PDF_SCANNED' }],
        confidence: 0.95,
      })),
    );
    mockCreateForm.mockResolvedValueOnce({ formId: 'form-pdf', item: {} });
    mockStartTextract.mockResolvedValueOnce('job-pdf');

    await baseHandler(baseEvent);

    // The PDF form is still IN_PROGRESS pending Textract; the callback runs the
    // readiness check. This handler still calls it (harmless no-op) after setting
    // FILLING_FORMS, so we only assert the file was moved to FILLING_FORMS here.
    expect(mockUpdateQuestionFile).toHaveBeenCalledWith(
      'proj-1', 'opp-1', 'qf-1',
      expect.objectContaining({ status: 'FILLING_FORMS' }),
    );
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
    // XLSX forms finish inline (no Textract callback), so this handler must run the
    // FORMS_READY check itself or the question file stays stuck in FILLING_FORMS.
    // The 4th arg carries the unmapped body-notary triggers (mocked to []).
    expect(mockMarkFormsReady).toHaveBeenCalledWith('org-1', 'proj-1', 'opp-1', []);
  });

  it('merges fields from every parsed sheet (instructions sheet contributes none, form sheet contributes all)', async () => {
    const xlsxEvent = {
      ...baseEvent,
      sourceFileKey: 'org-1/proj-1/opp-1/multipage.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    mockLoadTextFromS3.mockResolvedValueOnce('document text');
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({
        forms: [{ name: 'Multi-tab', formType: 'XLSX_FORM' }],
        confidence: 0.9,
      })),
    );
    mockCreateForm.mockResolvedValueOnce({ formId: 'form-multi', item: {} });
    // Parser only returns sheets that yielded fields — the instructions sheet is
    // absent, and the real fields live on the second (Compliance) sheet.
    mockParseXlsx.mockResolvedValueOnce([{
      sheetName: 'Compliance',
      formType: 'XLSX_MATRIX',
      fields: [
        { fieldId: 'a', label: 'MFA — Fully Meets', status: 'MANUAL_REQUIRED', matrixColumn: 'FULLY_MEETS', sheetName: 'Compliance', sheetIndex: 1 },
        { fieldId: 'b', label: 'MFA — Comments', status: 'EMPTY', matrixColumn: 'COMMENTS', sheetName: 'Compliance', sheetIndex: 1 },
      ],
    }]);
    mockAutofillMatrix.mockImplementationOnce(async ({ fields }: { fields: unknown[] }) => fields);

    await baseHandler(xlsxEvent);

    const readyCall = mockUpdateForm.mock.calls.find((c) => c[0].patch?.status === 'READY');
    expect(readyCall).toBeDefined();
    // Both fields from the Compliance sheet are preserved (none dropped).
    expect(readyCall![0].patch).toMatchObject({ status: 'READY', totalFieldCount: 2 });
    // A matrix sheet anywhere in the workbook forces review + autofill.
    expect(mockAutofillMatrix).toHaveBeenCalledTimes(1);
    expect(readyCall![0].patch).toHaveProperty('reviewRequired', true);
  });

  it('runs autofillMatrixComments and forces reviewRequired=true on XLSX_MATRIX forms', async () => {
    const xlsxEvent = {
      ...baseEvent,
      sourceFileKey: 'org-1/proj-1/opp-1/matrix.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    mockLoadTextFromS3.mockResolvedValueOnce('document text');
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({
        forms: [{ name: 'Attachment-A', formType: 'XLSX_MATRIX' }],
        confidence: 0.9,
      })),
    );
    mockCreateForm.mockResolvedValueOnce({ formId: 'form-m', item: {} });
    mockParseXlsx.mockResolvedValueOnce([{
      fields: [
        { fieldId: 'a', label: 'MFA — Comments', status: 'EMPTY', matrixColumn: 'COMMENTS', matrixFeature: 'MFA' },
        { fieldId: 'b', label: 'MFA — Fully Meets', status: 'MANUAL_REQUIRED', matrixColumn: 'FULLY_MEETS' },
      ],
    }]);
    mockAutofillMatrix.mockImplementationOnce(async ({ fields }: { fields: Array<{ fieldId: string; status: string; matrixColumn: string }> }) =>
      fields.map((f) =>
        f.matrixColumn === 'COMMENTS'
          ? { ...f, status: 'AUTO_FILLED', value: 'We support MFA via Cognito + WebAuthn.' }
          : f,
      ),
    );

    await baseHandler(xlsxEvent);

    expect(mockAutofillMatrix).toHaveBeenCalledTimes(1);
    expect(mockAutofillMatrix).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'org-1' }));
    const updateCall = mockUpdateForm.mock.calls.find((c) => c[0].patch?.status === 'READY');
    expect(updateCall).toBeDefined();
    expect(updateCall![0]).toMatchObject({
      formId: 'form-m',
      patch: expect.objectContaining({
        status: 'READY',
        totalFieldCount: 2,
        manualFieldCount: 1,
        autoFillPercentage: 50,
        reviewRequired: true,
      }),
    });
  });

  it('collapses multiple detected forms in ONE xlsx file into a single record', async () => {
    const xlsxEvent = {
      ...baseEvent,
      sourceFileKey: 'org-1/proj-1/opp-1/multi-sheet.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    mockLoadTextFromS3.mockResolvedValueOnce('document text');
    // The model names two "forms" from a two-fillable-sheet workbook. Since
    // parseXlsxForms reads the whole workbook, both records would be identical —
    // so only one record must be created.
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({
        forms: [
          { name: 'Sheet 1 Form', formType: 'XLSX_FORM' },
          { name: 'Sheet 2 Form', formType: 'XLSX_FORM' },
        ],
        confidence: 0.9,
      })),
    );
    mockCreateForm.mockResolvedValueOnce({ formId: 'form-single', item: {} });
    mockParseXlsx.mockResolvedValueOnce([{
      fields: [{ fieldId: 'a', label: 'Name', status: 'EMPTY' }],
    }]);

    const res = await baseHandler(xlsxEvent);

    expect(res.formsDetected).toBe(1);
    expect(mockCreateForm).toHaveBeenCalledTimes(1);
    expect(mockParseXlsx).toHaveBeenCalledTimes(1);
    // Keeps the first detected form's name as the representative.
    expect(mockCreateForm).toHaveBeenCalledWith(expect.objectContaining({
      dto: expect.objectContaining({ name: 'Sheet 1 Form' }),
    }));
  });

  it('collapses multiple detected forms in ONE docx file into a single record', async () => {
    const docxEvent = {
      ...baseEvent,
      sourceFileKey: 'org-1/proj-1/opp-1/multi-form.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    mockLoadTextFromS3.mockResolvedValueOnce('Company Name: ___\nSignature: ___');
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({
        forms: [
          { name: 'Rep & Cert', formType: 'DOCX_FORM' },
          { name: 'Offer Form', formType: 'DOCX_FORM' },
        ],
        confidence: 0.9,
      })),
    );
    mockCreateForm.mockResolvedValueOnce({ formId: 'form-docx-single', item: {} });
    mockExtractDocx.mockResolvedValueOnce({
      fields: [{ fieldId: 'a', label: 'Company Name', status: 'AUTO_FILLED', value: 'Acme' }],
      totalFieldCount: 1, manualFieldCount: 0, autoFillPercentage: 100, docxFillStrategy: 'TEXT_TOKEN',
    });

    const res = await baseHandler(docxEvent);

    expect(res.formsDetected).toBe(1);
    expect(mockCreateForm).toHaveBeenCalledTimes(1);
    // extractAndAutofillDocxForm runs once (not once per named form).
    expect(mockExtractDocx).toHaveBeenCalledTimes(1);
  });

  it('keeps ALL detected forms for a PDF (page-range partitioning is real)', async () => {
    mockLoadTextFromS3.mockResolvedValueOnce('document text');
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({
        forms: [
          { name: 'Form A', formType: 'PDF_SCANNED', pageRange: '1-2' },
          { name: 'Form B', formType: 'PDF_SCANNED', pageRange: '5-6' },
        ],
        confidence: 0.9,
      })),
    );
    mockCreateForm
      .mockResolvedValueOnce({ formId: 'form-a', item: {} })
      .mockResolvedValueOnce({ formId: 'form-b', item: {} });
    mockStartTextract.mockResolvedValue('job-x');

    const res = await baseHandler(baseEvent);

    expect(res.formsDetected).toBe(2);
    expect(mockCreateForm).toHaveBeenCalledTimes(2);
  });

  it('does NOT call autofillMatrixComments for non-matrix XLSX forms (XLSX_FORM)', async () => {
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
      fields: [{ fieldId: 'a', label: 'Name', status: 'EMPTY' }],
    }]);

    await baseHandler(xlsxEvent);

    expect(mockAutofillMatrix).not.toHaveBeenCalled();
    const readyCall = mockUpdateForm.mock.calls.find((c) => c[0].patch?.status === 'READY');
    // reviewRequired is left undefined (not forced) for XLSX_FORM
    expect(readyCall![0].patch).not.toHaveProperty('reviewRequired', true);
  });

  it('BACKSTOP: surfaces a detected XLSX form for manual review when the parser extracts 0 fields', async () => {
    const xlsxEvent = {
      ...baseEvent,
      sourceFileKey: 'org-1/proj-1/opp-1/file.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
    mockLoadTextFromS3.mockResolvedValueOnce('document text');
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({
        forms: [{ name: 'Unreadable Pricing Form', formType: 'XLSX_FORM' }],
        confidence: 0.9,
      })),
    );
    mockCreateForm.mockResolvedValueOnce({ formId: 'form-empty', item: {} });
    // Parser finds no fillable structure (a layout it can't map).
    mockParseXlsx.mockResolvedValueOnce([]);

    await baseHandler(xlsxEvent);

    // The form is NOT dropped — it is written READY, flagged for review, with a
    // message telling the user to complete it from the attached file.
    const call = mockUpdateForm.mock.calls.find((c) => c[0].formId === 'form-empty');
    expect(call).toBeDefined();
    expect(call![0].patch.status).toBe('READY');
    expect(call![0].patch.reviewRequired).toBe(true);
    expect(call![0].patch.totalFieldCount).toBe(0);
    expect(call![0].patch.errorMessage).toMatch(/no fillable cells|manually/i);
  });

  it('parses DOCX inline (no Textract), autofills from profile, and writes READY', async () => {
    const docxEvent = {
      ...baseEvent,
      sourceFileKey: 'org-1/proj-1/opp-1/Request for Proposal.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    mockLoadTextFromS3.mockResolvedValueOnce('Company Name: ___\nAuthorized Signature: ___');
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({
        forms: [{ name: 'Offer Submission Form', formType: 'DOCX_FORM' }],
        confidence: 0.9,
      })),
    );
    mockCreateForm.mockResolvedValueOnce({ formId: 'form-d', item: {} });
    mockExtractDocx.mockResolvedValueOnce({
      fields: [
        { fieldId: 'a', label: 'Company Name', status: 'AUTO_FILLED', value: 'Acme' },
        { fieldId: 'b', label: 'Authorized Signature', status: 'MANUAL_REQUIRED' },
      ],
      totalFieldCount: 2,
      manualFieldCount: 1,
      autoFillPercentage: 50,
      docxFillStrategy: 'TEXT_TOKEN',
    });

    const res = await baseHandler(docxEvent);

    expect(res).toEqual({ ok: true, formsDetected: 1 });
    expect(mockStartTextract).not.toHaveBeenCalled();
    // Now receives the raw buffer for structure detection alongside text + orgId.
    expect(mockExtractDocx).toHaveBeenCalledWith(
      expect.any(Buffer), 'Company Name: ___\nAuthorized Signature: ___', 'org-1',
    );
    const readyCall = mockUpdateForm.mock.calls.find((c) => c[0].patch?.status === 'READY');
    expect(readyCall![0]).toMatchObject({
      formId: 'form-d',
      patch: expect.objectContaining({
        status: 'READY',
        totalFieldCount: 2,
        manualFieldCount: 1,
        autoFillPercentage: 50,
      }),
    });
  });

  it('writes READY with zero fields for a DOCX form with no extracted fields', async () => {
    const docxEvent = {
      ...baseEvent,
      sourceFileKey: 'org-1/proj-1/opp-1/notice.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    mockLoadTextFromS3.mockResolvedValueOnce('informational notice, no blanks');
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({
        forms: [{ name: 'Notice', formType: 'DOCX_FORM' }],
        confidence: 0.9,
      })),
    );
    mockCreateForm.mockResolvedValueOnce({ formId: 'form-e', item: {} });
    mockExtractDocx.mockResolvedValueOnce({
      fields: [], totalFieldCount: 0, manualFieldCount: 0, autoFillPercentage: 0, docxFillStrategy: 'TEXT_TOKEN',
    });

    await baseHandler(docxEvent);

    const readyCall = mockUpdateForm.mock.calls.find((c) => c[0].patch?.status === 'READY');
    // Zero-field DOCX is surfaced for manual review (backstop), not dropped.
    expect(readyCall![0].patch).toMatchObject({
      status: 'READY', totalFieldCount: 0, reviewRequired: true,
    });
  });

  it('marks a DOCX form FAILED if field extraction throws', async () => {
    const docxEvent = {
      ...baseEvent,
      sourceFileKey: 'org-1/proj-1/opp-1/form.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    };
    mockLoadTextFromS3.mockResolvedValueOnce('some text');
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({
        forms: [{ name: 'Form', formType: 'DOCX_FORM' }],
        confidence: 0.9,
      })),
    );
    mockCreateForm.mockResolvedValueOnce({ formId: 'form-f', item: {} });
    mockExtractDocx.mockRejectedValueOnce(new Error('bedrock down'));

    await baseHandler(docxEvent);

    expect(mockUpdateForm).toHaveBeenLastCalledWith(expect.objectContaining({
      formId: 'form-f',
      patch: expect.objectContaining({ status: 'FAILED', errorMessage: 'bedrock down' }),
    }));
  });

  it('marks a form FAILED (not NEW) for an unsupported mime type so the file is not stuck', async () => {
    const imageEvent = {
      ...baseEvent,
      sourceFileKey: 'org-1/proj-1/opp-1/scan.png',
      mimeType: 'image/png',
    };
    mockLoadTextFromS3.mockResolvedValueOnce('document text');
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({
        forms: [{ name: 'Scanned Cert', formType: 'PDF_SCANNED' }],
        confidence: 0.9,
      })),
    );
    mockCreateForm.mockResolvedValueOnce({ formId: 'form-img', item: {} });

    const res = await baseHandler(imageEvent);

    expect(res.formsDetected).toBe(1);
    // No PDF/XLSX/DOCX parser applies; the form must be terminal (FAILED), not NEW,
    // or markFormsReadyIfAllDone would treat it as pending forever.
    expect(mockUpdateForm).toHaveBeenCalledWith(expect.objectContaining({
      formId: 'form-img',
      patch: expect.objectContaining({ status: 'FAILED' }),
    }));
    expect(mockStartTextract).not.toHaveBeenCalled();
    // Readiness check still runs so the question file can leave FILLING_FORMS.
    expect(mockMarkFormsReady).toHaveBeenCalledWith('org-1', 'proj-1', 'opp-1', []);
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

  it('dedups a boundary-straddling form whose second half has a continuation marker', async () => {
    // Long PDF: the same form is reported in two chunks, the second labelled "(cont.)".
    // Conservative name normalization must treat them as one form.
    mockLoadTextFromS3.mockResolvedValueOnce('x'.repeat(150_000 * 2));
    mockInvokeModel
      .mockResolvedValueOnce(
        encodeModelResponse(JSON.stringify({
          forms: [{ name: 'Certification Form', formType: 'PDF_SCANNED' }],
          confidence: 0.9,
        })),
      )
      .mockResolvedValue(
        encodeModelResponse(JSON.stringify({
          forms: [{ name: 'Certification Form (cont.)', formType: 'PDF_SCANNED' }],
          confidence: 0.9,
        })),
      );
    mockCreateForm.mockResolvedValueOnce({ formId: 'form-straddle', item: {} });
    mockStartTextract.mockResolvedValue('job-straddle');

    const res = await baseHandler({ ...baseEvent, docType: 'OTHER' });

    // One record, one S3 copy, one Textract job — not two.
    expect(res.formsDetected).toBe(1);
    expect(mockCreateForm).toHaveBeenCalledTimes(1);
    expect(mockCopyS3Object).toHaveBeenCalledTimes(1);
    expect(mockStartTextract).toHaveBeenCalledTimes(1);
  });

  it('does NOT dedup genuinely distinct forms that differ only by number', async () => {
    // Guard against over-merging: "Attachment 3" and "Attachment 5" are different forms.
    mockLoadTextFromS3.mockResolvedValueOnce('x'.repeat(150_000 * 2));
    mockInvokeModel
      .mockResolvedValueOnce(
        encodeModelResponse(JSON.stringify({
          forms: [{ name: 'Attachment 3', formType: 'PDF_SCANNED' }],
          confidence: 0.9,
        })),
      )
      .mockResolvedValue(
        encodeModelResponse(JSON.stringify({
          forms: [{ name: 'Attachment 5', formType: 'PDF_SCANNED' }],
          confidence: 0.9,
        })),
      );
    mockCreateForm
      .mockResolvedValueOnce({ formId: 'form-a3', item: {} })
      .mockResolvedValueOnce({ formId: 'form-a5', item: {} });
    mockStartTextract.mockResolvedValue('job-x');

    const res = await baseHandler({ ...baseEvent, docType: 'OTHER' });

    expect(res.formsDetected).toBe(2);
    expect(mockCreateForm).toHaveBeenCalledTimes(2);
  });

  describe('notary body scan wiring (WF-A)', () => {
    it('runs the body notary scan after creating forms and forwards its unmapped triggers to the rollup', async () => {
      mockLoadTextFromS3.mockResolvedValueOnce('the offeror must have this notarized');
      mockInvokeModel.mockResolvedValueOnce(
        encodeModelResponse(JSON.stringify({
          forms: [{ name: 'Cert', formType: 'PDF_SCANNED' }],
          confidence: 0.95,
        })),
      );
      mockCreateForm.mockResolvedValueOnce({ formId: 'form-n', item: {} });
      mockStartTextract.mockResolvedValueOnce('job-n');
      const unmapped = [
        { documentName: 'solicitation', status: 'POSSIBLY_REQUIRED', cue: 'KEYWORD', pageNumber: null, triggeringText: 'notary' },
      ];
      mockRunBodyNotaryScan.mockResolvedValueOnce(unmapped);

      await baseHandler(baseEvent);

      expect(mockRunBodyNotaryScan).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1',
          docText: 'the offeror must have this notarized',
          truncated: false,
        }),
      );
      // The unmapped triggers flow into the rollup via markFormsReadyIfAllDone.
      expect(mockMarkFormsReady).toHaveBeenCalledWith('org-1', 'proj-1', 'opp-1', unmapped);
    });

    it('signals truncation to the body scan when the detection scan is capped (>8 chunks)', async () => {
      // 10 windows → >8 chunks → the scan is truncated. A form is detected in the
      // scanned chunks (same name every chunk → deduped to one) so createdCount > 0.
      mockLoadTextFromS3.mockResolvedValueOnce('x'.repeat(150_000 * 10));
      mockInvokeModel.mockResolvedValue(
        encodeModelResponse(JSON.stringify({
          forms: [{ name: 'Early Cert', formType: 'PDF_SCANNED' }],
          confidence: 0.95,
        })),
      );
      mockCreateForm.mockResolvedValueOnce({ formId: 'form-early', item: {} });
      mockStartTextract.mockResolvedValue('job-early');

      await baseHandler({ ...baseEvent, docType: 'OTHER' });

      expect(mockRunBodyNotaryScan).toHaveBeenCalledWith(expect.objectContaining({ truncated: true }));
    });

    it('scans a zero-forms document and rolls up directly when its body flags notarization (FR2.1)', async () => {
      // "Your bid must be notarized" in a solicitation with NO fillable forms:
      // the scan must still run and the opportunity must still be flagged —
      // this was the one gap in the zero-miss guarantee.
      mockLoadTextFromS3.mockResolvedValueOnce('your bid must be notarized');
      mockInvokeModel.mockResolvedValueOnce(
        encodeModelResponse(JSON.stringify({ forms: [], confidence: 1.0 })),
      );
      const unmapped = [
        { documentName: 'solicitation', status: 'POSSIBLY_REQUIRED', cue: 'KEYWORD', pageNumber: null, triggeringText: 'must be notarized' },
      ];
      mockRunBodyNotaryScan.mockResolvedValueOnce(unmapped);

      const res = await baseHandler(baseEvent);

      expect(res).toEqual({ ok: true, formsDetected: 0 });
      expect(mockRunBodyNotaryScan).toHaveBeenCalledWith(
        expect.objectContaining({
          orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1',
          docText: 'your bid must be notarized',
        }),
      );
      // Zero forms → no form will ever go terminal, so the rollup fires directly…
      expect(mockRollupNotary).toHaveBeenCalledWith(
        expect.objectContaining({ oppId: 'opp-1', forms: [], unmappedTriggers: unmapped }),
      );
      // …and markFormsReadyIfAllDone must NOT run (it would clobber the status of
      // question files that were never FILLING_FORMS).
      expect(mockMarkFormsReady).not.toHaveBeenCalled();
    });

    it('skips the direct rollup when a zero-forms document has no notary triggers', async () => {
      mockLoadTextFromS3.mockResolvedValueOnce('document text');
      mockInvokeModel.mockResolvedValueOnce(
        encodeModelResponse(JSON.stringify({ forms: [], confidence: 1.0 })),
      );
      await baseHandler(baseEvent);
      expect(mockRunBodyNotaryScan).toHaveBeenCalled();
      expect(mockRollupNotary).not.toHaveBeenCalled();
      expect(mockMarkFormsReady).not.toHaveBeenCalled();
    });

    it('routes a zero-forms document through markFormsReadyIfAllDone when OTHER documents own forms', async () => {
      // Another document of this opportunity already created a form: the
      // readiness check owns the rollup timing (it may still be pending).
      mockListForms.mockResolvedValue([{ formId: 'form-x', name: 'Other Doc Form', status: 'READY' }]);
      mockLoadTextFromS3.mockResolvedValueOnce('all certifications must be notarized');
      mockInvokeModel.mockResolvedValueOnce(
        encodeModelResponse(JSON.stringify({ forms: [], confidence: 1.0 })),
      );
      const unmapped = [
        { documentName: 'solicitation', status: 'POSSIBLY_REQUIRED', cue: 'INSTRUCTIONAL', pageNumber: null, triggeringText: 'must be notarized' },
      ];
      mockRunBodyNotaryScan.mockResolvedValueOnce(unmapped);

      await baseHandler(baseEvent);

      expect(mockMarkFormsReady).toHaveBeenCalledWith('org-1', 'proj-1', 'opp-1', unmapped);
      expect(mockRollupNotary).not.toHaveBeenCalled();
    });

    it('re-extract regression: runs the scan + rollup when every detected form ALREADY exists (createdCount 0)', async () => {
      // Re-extract-all restarts the pipeline on an opportunity whose forms were
      // created in the first run: each detected form is skipped as a duplicate,
      // so createdCount === 0. The notary scan + rollup (and its notification)
      // must still fire — gating them on createdCount silently skipped both.
      mockListForms.mockResolvedValue([{ formId: 'form-cert', name: 'Cert', notaryRequirements: [] }]);
      mockLoadTextFromS3.mockResolvedValueOnce('the offeror must have this notarized');
      mockInvokeModel.mockResolvedValueOnce(
        encodeModelResponse(JSON.stringify({
          forms: [{ name: 'Cert', formType: 'PDF_SCANNED' }],
          confidence: 0.95,
        })),
      );
      const unmapped = [
        { documentName: 'solicitation', status: 'POSSIBLY_REQUIRED', cue: 'KEYWORD', pageNumber: null, triggeringText: 'notary' },
      ];
      mockRunBodyNotaryScan.mockResolvedValueOnce(unmapped);

      const res = await baseHandler(baseEvent);

      // No new form record — the duplicate is skipped…
      expect(res.formsDetected).toBe(0);
      expect(mockCreateForm).not.toHaveBeenCalled();
      // …but the scan and the rollup still run for the existing forms.
      expect(mockRunBodyNotaryScan).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' }),
      );
      expect(mockMarkFormsReady).toHaveBeenCalledWith('org-1', 'proj-1', 'opp-1', unmapped);
      // The FILLING_FORMS transition stays gated on newly created forms.
      expect(mockUpdateQuestionFile).not.toHaveBeenCalled();
    });
  });

  describe('long documents (multi-chunk scan)', () => {
    // A window is 150k chars; anything larger is chunked into multiple sequential
    // model calls. Chunk overlap makes the exact chunk count awkward to predict, so
    // these tests drive detection off chunk CONTENT (a sentinel) rather than call order.
    const makeLongText = (windowCount: number): string => 'x'.repeat(150_000 * windowCount);

    // Returns a form only for the chunk whose text contains `marker`; empty otherwise.
    const respondWhenChunkContains = (marker: string, form: DetectedFormResultLike) =>
      (_modelId: string, bodyJson: string) => {
        const body = bodyJson.includes(marker)
          ? { forms: [form], confidence: 0.95 }
          : { forms: [], confidence: 1.0 };
        return Promise.resolve(encodeModelResponse(JSON.stringify(body)));
      };

    it('makes a single model call for a document that fits one window', async () => {
      mockLoadTextFromS3.mockResolvedValueOnce('short document');
      mockInvokeModel.mockResolvedValueOnce(
        encodeModelResponse(JSON.stringify({ forms: [], confidence: 1.0 })),
      );

      await baseHandler({ ...baseEvent, docType: 'OTHER' });

      expect(mockInvokeModel).toHaveBeenCalledTimes(1);
    });

    it('detects a form that appears only in a later chunk of a long document', async () => {
      // Marker at the very end lands in the final chunk — the exact failure mode of
      // the reported bug (form at the end of a 100+ page doc, classified OTHER).
      mockLoadTextFromS3.mockResolvedValueOnce(makeLongText(3) + 'END_OF_DOC_FORM_MARKER');
      mockInvokeModel.mockImplementation(
        respondWhenChunkContains('END_OF_DOC_FORM_MARKER', { name: 'End-of-Doc Cert', formType: 'PDF_SCANNED' }),
      );
      mockCreateForm.mockResolvedValueOnce({ formId: 'form-late', item: {} });
      mockStartTextract.mockResolvedValueOnce('job-late');

      const res = await baseHandler({ ...baseEvent, docType: 'OTHER' });

      // More than one chunk was scanned, and the late form was found.
      expect(mockInvokeModel.mock.calls.length).toBeGreaterThan(1);
      expect(res.formsDetected).toBe(1);
      expect(mockCreateForm).toHaveBeenCalledWith(expect.objectContaining({
        dto: expect.objectContaining({ name: 'End-of-Doc Cert' }),
      }));
    });

    it('dedups a form that appears in multiple chunks (e.g. across a boundary)', async () => {
      mockLoadTextFromS3.mockResolvedValueOnce(makeLongText(3));
      // Every chunk reports the same form (case-insensitively) — as if a form's text
      // straddled boundaries and surfaced in several windows.
      mockInvokeModel.mockResolvedValue(
        encodeModelResponse(JSON.stringify({
          forms: [{ name: 'Straddling Form', formType: 'PDF_SCANNED' }],
          confidence: 0.9,
        })),
      );
      mockCreateForm.mockResolvedValueOnce({ formId: 'form-dedup', item: {} });
      mockStartTextract.mockResolvedValueOnce('job-dedup');

      const res = await baseHandler({ ...baseEvent, docType: 'OTHER' });

      // Multiple chunks returned the form, but name-based dedup creates it once.
      expect(mockInvokeModel.mock.calls.length).toBeGreaterThan(1);
      expect(res.formsDetected).toBe(1);
      expect(mockCreateForm).toHaveBeenCalledTimes(1);
    });

    it('promotes docType to REQUIRED_FORM when a form is found on an OTHER document', async () => {
      mockLoadTextFromS3.mockResolvedValueOnce('document text');
      mockInvokeModel.mockResolvedValueOnce(
        encodeModelResponse(JSON.stringify({
          forms: [{ name: 'Late Form', formType: 'PDF_SCANNED' }],
          confidence: 0.95,
        })),
      );
      mockCreateForm.mockResolvedValueOnce({ formId: 'form-promote', item: {} });
      mockStartTextract.mockResolvedValueOnce('job-promote');

      await baseHandler({ ...baseEvent, docType: 'OTHER' });

      expect(mockUpdateQuestionFile).toHaveBeenCalledWith(
        'proj-1', 'opp-1', 'qf-1',
        expect.objectContaining({ status: 'FILLING_FORMS', docType: 'REQUIRED_FORM' }),
      );
    });

    it('does not re-write docType when it is already REQUIRED_FORM', async () => {
      mockLoadTextFromS3.mockResolvedValueOnce('document text');
      mockInvokeModel.mockResolvedValueOnce(
        encodeModelResponse(JSON.stringify({
          forms: [{ name: 'Form', formType: 'PDF_SCANNED' }],
          confidence: 0.95,
        })),
      );
      mockCreateForm.mockResolvedValueOnce({ formId: 'form-noop', item: {} });
      mockStartTextract.mockResolvedValueOnce('job-noop');

      await baseHandler({ ...baseEvent, docType: 'REQUIRED_FORM' });

      const fillingCall = mockUpdateQuestionFile.mock.calls.find((c) => c[3]?.status === 'FILLING_FORMS');
      expect(fillingCall).toBeDefined();
      expect(fillingCall![3]).not.toHaveProperty('docType');
    });

    it('caps the scan at 8 chunks and warns about the dropped tail', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      // 10 windows (~1.5M chars) produces more than 8 chunks; the cap bounds the scan.
      mockLoadTextFromS3.mockResolvedValueOnce(makeLongText(10));
      mockInvokeModel.mockResolvedValue(
        encodeModelResponse(JSON.stringify({ forms: [], confidence: 1.0 })),
      );

      const res = await baseHandler({ ...baseEvent, docType: 'OTHER' });

      expect(mockInvokeModel).toHaveBeenCalledTimes(8);
      expect(res.formsDetected).toBe(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Form detection truncated'));
      warnSpy.mockRestore();
    });
  });
});
