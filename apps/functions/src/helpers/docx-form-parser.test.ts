const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: (...args: unknown[]) => mockInvokeModel(...args),
}));

jest.mock('@/helpers/json', () => ({
  safeParseJsonFromModel: (text: string) => JSON.parse(text),
}));

let uuidCounter = 0;
jest.mock('uuid', () => ({ v4: () => `uuid-${++uuidCounter}` }));

const mockGetCompanyProfile = jest.fn();
jest.mock('@/helpers/company-profile', () => ({
  getCompanyProfile: (...args: unknown[]) => mockGetCompanyProfile(...args),
}));

const mockAutofillFields = jest.fn();
jest.mock('@/helpers/autofill-fields-with-tools', () => ({
  autofillFieldsWithTools: (...args: unknown[]) => mockAutofillFields(...args),
}));

process.env.BEDROCK_MODEL_ID = 'anthropic.claude-test';

import { parseDocxForms, extractAndAutofillDocxForm } from './docx-form-parser';

const encodeModelResponse = (text: string): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text }] }));

beforeEach(() => {
  jest.clearAllMocks();
  uuidCounter = 0;
});

describe('parseDocxForms', () => {
  it('extracts labelled fields from docx text into DetectedFormField[]', async () => {
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({
        fields: [
          { label: 'Company Name' },
          { label: 'EIN' },
          { label: 'Authorized Signature' },
        ],
      })),
    );

    const fields = await parseDocxForms('Company Name: ____\nEIN: ____\nAuthorized Signature: ____');

    expect(fields).toHaveLength(3);
    expect(fields[0]).toMatchObject({
      fieldId: 'uuid-1',
      label: 'Company Name',
      value: null,
      status: 'EMPTY',
      markType: 'TEXT',
    });
    expect(fields.map((f) => f.label)).toEqual(['Company Name', 'EIN', 'Authorized Signature']);
  });

  it('returns an empty array when the model reports no fields', async () => {
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({ fields: [] })),
    );
    const fields = await parseDocxForms('Purely informational scope of work.');
    expect(fields).toEqual([]);
  });

  it('throws when the model returns unparseable output (not a field-less doc)', async () => {
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse('not json at all no braces'),
    );
    // A parse failure must surface as an error so the caller marks the form
    // FAILED — it must NOT be swallowed into an empty (READY, 0-field) result.
    await expect(parseDocxForms('some text')).rejects.toThrow();
  });

  it('skips field entries without a usable label', async () => {
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({
        fields: [{ label: 'Address' }, { label: '' }, { notLabel: 'x' }],
      })),
    );
    const fields = await parseDocxForms('Address: ___');
    expect(fields).toHaveLength(1);
    expect(fields[0].label).toBe('Address');
  });

  it('caps the number of fields to avoid runaway output', async () => {
    const many = Array.from({ length: 500 }, (_, i) => ({ label: `Field ${i}` }));
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({ fields: many })),
    );
    const fields = await parseDocxForms('lots of blanks');
    expect(fields.length).toBeLessThanOrEqual(200);
  });
});

describe('extractAndAutofillDocxForm', () => {
  it('extracts, autofills from profile, and computes stats', async () => {
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({ fields: [{ label: 'Company Name' }, { label: 'Signature' }] })),
    );
    mockGetCompanyProfile.mockResolvedValueOnce({ companyName: 'Acme' });
    mockAutofillFields.mockResolvedValueOnce([
      { fieldId: 'uuid-1', label: 'Company Name', status: 'AUTO_FILLED', value: 'Acme' },
      { fieldId: 'uuid-2', label: 'Signature', status: 'MANUAL_REQUIRED', value: null },
    ]);

    const result = await extractAndAutofillDocxForm('Company Name: __\nSignature: __', 'org-1');

    expect(mockGetCompanyProfile).toHaveBeenCalledWith('org-1');
    expect(mockAutofillFields).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      totalFieldCount: 2,
      manualFieldCount: 1,
      autoFillPercentage: 50,
    });
  });

  it('skips profile lookup and autofill when no fields are extracted', async () => {
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({ fields: [] })),
    );

    const result = await extractAndAutofillDocxForm('no blanks', 'org-1');

    expect(mockGetCompanyProfile).not.toHaveBeenCalled();
    expect(mockAutofillFields).not.toHaveBeenCalled();
    expect(result).toEqual({ fields: [], totalFieldCount: 0, manualFieldCount: 0, autoFillPercentage: 0 });
  });

  it('keeps fields unfilled when the org has no company profile', async () => {
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({ fields: [{ label: 'Company Name' }] })),
    );
    mockGetCompanyProfile.mockResolvedValueOnce(null);

    const result = await extractAndAutofillDocxForm('Company Name: __', 'org-1');

    expect(mockAutofillFields).not.toHaveBeenCalled();
    expect(result.totalFieldCount).toBe(1);
    expect(result.autoFillPercentage).toBe(0);
    expect(result.fields[0].status).toBe('EMPTY');
  });
});
