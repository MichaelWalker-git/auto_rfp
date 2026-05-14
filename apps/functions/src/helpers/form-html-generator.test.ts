jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});

const mockInvokeModel = jest.fn();
jest.mock('./bedrock-http-client', () => ({
  invokeModel: (...args: unknown[]) => mockInvokeModel(...args),
}));

jest.mock('./env', () => ({
  requireEnv: (key: string, fallback?: string) => {
    if (key === 'BEDROCK_MODEL_ID') return 'test-model';
    return fallback ?? 'test-value';
  },
}));

process.env.BEDROCK_MODEL_ID = 'test-model';

import { generateFormHtml } from './form-html-generator';
import type { DetectedFormField, CompanyProfileItem } from '@auto-rfp/core';

describe('generateFormHtml', () => {
  const makeField = (overrides: Partial<DetectedFormField> = {}): DetectedFormField => ({
    fieldId: 'f1',
    label: 'Company Name',
    value: null,
    status: 'EMPTY',
    confidence: null,
    profileFieldKey: null,
    manualReason: null,
    pageNumber: null,
    cellReference: null,
    boundingBox: null,
    ...overrides,
  });

  const mockProfile: CompanyProfileItem = {
    orgId: 'org1',
    companyName: 'Acme Corp',
    legalEntityName: null,
    dba: null,
    address: '123 Main St',
    city: 'San Diego',
    state: 'CA',
    zip: '92117',
    phone: null,
    email: null,
    website: null,
    ein: '12-345',
    uei: null,
    cage: null,
    primaryNaics: null,
    secondaryNaics: [],
    entityType: null,
    stateEntityNumber: null,
    smallBusinessCertId: null,
    smallBusinessCertExpiration: null,
    fields: [],
    authorizedSignatory: null,
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('calls LLM and returns generated HTML', async () => {
    const fakeHtml = '<div style="font-family: serif;"><h1>Tax Form</h1><p>Company: Acme Corp</p></div>';
    mockInvokeModel.mockResolvedValue(
      new TextEncoder().encode(JSON.stringify({
        content: [{ type: 'text', text: fakeHtml }],
      })),
    );

    const fields: DetectedFormField[] = [
      makeField({ fieldId: 'f1', label: 'Company Name', value: 'Acme Corp', status: 'AUTO_FILLED' }),
    ];

    const result = await generateFormHtml({
      formName: 'Tax Form',
      sourceFileName: 'tax.pdf',
      documentText: 'This is the tax exemption form...',
      fields,
      profile: mockProfile,
    });

    expect(result).toContain('Tax Form');
    expect(result).toContain('Acme Corp');
    expect(mockInvokeModel).toHaveBeenCalledTimes(1);
  });

  it('falls back to basic HTML when LLM fails', async () => {
    mockInvokeModel.mockRejectedValue(new Error('Bedrock timeout'));

    const fields: DetectedFormField[] = [
      makeField({ fieldId: 'f1', label: 'EIN', value: '12-345', status: 'AUTO_FILLED' }),
      makeField({ fieldId: 'f2', label: 'Signature', status: 'MANUAL_REQUIRED', manualReason: 'Requires signature' }),
    ];

    const result = await generateFormHtml({
      formName: 'W-9',
      sourceFileName: 'w9.pdf',
      documentText: 'W-9 form...',
      fields,
      profile: mockProfile,
    });

    expect(result).toContain('W-9');
    expect(result).toContain('12-345');
    expect(result).toContain('Requires signature');
  });

  it('generates fallback for empty fields', async () => {
    mockInvokeModel.mockResolvedValue(
      new TextEncoder().encode(JSON.stringify({
        content: [{ type: 'text', text: '' }],
      })),
    );

    const result = await generateFormHtml({
      formName: 'Empty Form',
      sourceFileName: 'test.pdf',
      documentText: 'some text',
      fields: [],
      profile: null,
    });

    expect(result).toContain('Empty Form');
    expect(result).toContain('field extraction was not possible');
  });
});
