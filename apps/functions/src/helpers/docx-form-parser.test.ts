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

const mockDetectDocxStructure = jest.fn();
jest.mock('./docx-structure', () => ({
  detectDocxStructure: (...args: unknown[]) => mockDetectDocxStructure(...args),
}));

process.env.BEDROCK_MODEL_ID = 'anthropic.claude-test';

// Default: no structured controls, no tokens → TEXT_TOKEN with an empty field
// list, so extraction falls through to the LLM-over-text path. IN_PLACE and
// token-bearing tests override this.
const TEXT_TOKEN_EMPTY = { strategy: 'TEXT_TOKEN' as const, structuredFields: [] };
const EMPTY_BUFFER = Buffer.from('');

import { parseDocxForms, extractAndAutofillDocxForm } from './docx-form-parser';

const encodeModelResponse = (text: string): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text }] }));

beforeEach(() => {
  jest.clearAllMocks();
  uuidCounter = 0;
  mockDetectDocxStructure.mockResolvedValue(TEXT_TOKEN_EMPTY);
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

  it('threads orgId through to invokeModel as the third argument', async () => {
    mockInvokeModel.mockResolvedValueOnce(encodeModelResponse(JSON.stringify({ fields: [] })));
    await parseDocxForms('Company Name: ____', 'the-org-id');
    expect(mockInvokeModel).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'the-org-id',
    );
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

    const result = await extractAndAutofillDocxForm(EMPTY_BUFFER, 'Company Name: __\nSignature: __', 'org-1');

    expect(mockGetCompanyProfile).toHaveBeenCalledWith('org-1');
    expect(mockAutofillFields).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      totalFieldCount: 2,
      manualFieldCount: 1,
      autoFillPercentage: 50,
      docxFillStrategy: 'TEXT_TOKEN',
    });
  });

  it('uses structured fields (IN_PLACE) and skips LLM extraction when controls exist', async () => {
    mockDetectDocxStructure.mockResolvedValueOnce({
      strategy: 'IN_PLACE',
      structuredFields: [
        { anchor: { kind: 'SDT', ref: '111', sourceLabel: 'Company Name' }, label: 'Company Name', markType: 'TEXT' },
        { anchor: { kind: 'SDT', ref: '222', sourceLabel: 'Agree' }, label: 'Agree', markType: 'CHECKBOX' },
      ],
    });
    mockGetCompanyProfile.mockResolvedValueOnce({ companyName: 'Acme' });
    mockAutofillFields.mockImplementationOnce((fields: unknown) => fields);

    const result = await extractAndAutofillDocxForm(EMPTY_BUFFER, 'irrelevant text', 'org-1');

    // LLM extraction must NOT run for structured docs.
    expect(mockInvokeModel).not.toHaveBeenCalled();
    expect(result.docxFillStrategy).toBe('IN_PLACE');
    expect(result.totalFieldCount).toBe(2);
    expect(result.fields[0].docxAnchor).toEqual({ kind: 'SDT', ref: '111', sourceLabel: 'Company Name' });
    expect(result.fields[1].markType).toBe('CHECKBOX');
  });

  it('trusts anchored fields exclusively and does NOT run the LLM when detection found spots (TEXT_TOKEN)', async () => {
    // Detection found the fillable spots (anchored, exportable).
    mockDetectDocxStructure.mockResolvedValueOnce({
      strategy: 'TEXT_TOKEN',
      structuredFields: [
        { anchor: { kind: 'TEXT_TOKEN', ref: '[INSERT SUPPLIER NAME]', occurrence: null, sourceLabel: 'Supplier Name' }, label: 'Supplier Name', markType: 'TEXT' },
        { anchor: { kind: 'TEXT_LABEL', ref: 'By:', occurrence: 1, sourceLabel: 'Supplier — By:' }, label: 'Supplier — By:', markType: 'TEXT' },
      ],
    });
    mockGetCompanyProfile.mockResolvedValueOnce({ companyName: 'Acme' });
    mockAutofillFields.mockImplementationOnce((fields: unknown) => fields);

    const result = await extractAndAutofillDocxForm(EMPTY_BUFFER, 'text', 'org-1');

    // The LLM pass must NOT run — it would produce anchor-less duplicates
    // ("Supplier By") that silently do nothing on export.
    expect(mockInvokeModel).not.toHaveBeenCalled();
    expect(result.docxFillStrategy).toBe('TEXT_TOKEN');
    expect(result.totalFieldCount).toBe(2);
    // Every field carries an anchor → every field is exportable.
    expect(result.fields.every((f) => f.docxAnchor !== null)).toBe(true);
  });

  it('falls back to the LLM ONLY when detection found no spots (TEXT_TOKEN)', async () => {
    mockDetectDocxStructure.mockResolvedValueOnce({ strategy: 'TEXT_TOKEN', structuredFields: [] });
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({ fields: [{ label: 'Authorized Signature' }] })),
    );
    mockGetCompanyProfile.mockResolvedValueOnce({ companyName: 'Acme' });
    mockAutofillFields.mockImplementationOnce((fields: unknown) => fields);

    const result = await extractAndAutofillDocxForm(EMPTY_BUFFER, 'text with no recognizable spots', 'org-1');

    expect(mockInvokeModel).toHaveBeenCalledTimes(1);
    expect(result.totalFieldCount).toBe(1);
    // Anchor-less manual field, surfaced so nothing is silently dropped.
    expect(result.fields[0].docxAnchor).toBeNull();
    // orgId flows from the caller into the LLM-fallback parse → invokeModel.
    expect(mockInvokeModel).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'org-1',
    );
  });

  it('skips profile lookup and autofill when no fields are extracted', async () => {
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({ fields: [] })),
    );

    const result = await extractAndAutofillDocxForm(EMPTY_BUFFER, 'no blanks', 'org-1');

    expect(mockGetCompanyProfile).not.toHaveBeenCalled();
    expect(mockAutofillFields).not.toHaveBeenCalled();
    expect(result).toEqual({
      fields: [], totalFieldCount: 0, manualFieldCount: 0, autoFillPercentage: 0, docxFillStrategy: 'TEXT_TOKEN',
    });
  });

  it('keeps fields unfilled when the org has no company profile', async () => {
    mockInvokeModel.mockResolvedValueOnce(
      encodeModelResponse(JSON.stringify({ fields: [{ label: 'Company Name' }] })),
    );
    mockGetCompanyProfile.mockResolvedValueOnce(null);

    const result = await extractAndAutofillDocxForm(EMPTY_BUFFER, 'Company Name: __', 'org-1');

    expect(mockAutofillFields).not.toHaveBeenCalled();
    expect(result.totalFieldCount).toBe(1);
    expect(result.autoFillPercentage).toBe(0);
    expect(result.fields[0].status).toBe('EMPTY');
  });
});
