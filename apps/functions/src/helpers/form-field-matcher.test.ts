const mockInvokeModel = jest.fn();
jest.mock('./bedrock-http-client', () => ({
  invokeModel: (...args: unknown[]) => mockInvokeModel(...args),
}));

process.env.BEDROCK_MODEL_ID = 'test-model';
process.env.BEDROCK_REGION = 'us-east-1';
process.env.BEDROCK_API_KEY_SSM_PARAM = '/test/key';

import { matchFieldsToProfile } from './form-field-matcher';
import type { DetectedFormField, CompanyProfileItem } from '@auto-rfp/core';

const makeBedrockResponse = (json: unknown) =>
  new TextEncoder().encode(JSON.stringify({
    content: [{ type: 'text', text: JSON.stringify(json) }],
  }));

const makeField = (overrides: Partial<DetectedFormField> = {}): DetectedFormField => ({
  fieldId: 'f1',
  label: 'Company Name',
  value: null,
  status: 'EMPTY',
  confidence: 0,
  profileFieldKey: null,
  manualReason: null,
  pageNumber: 1,
  cellReference: null,
  boundingBox: null,
  ...overrides,
});

const baseProfile: CompanyProfileItem = {
  orgId: 'org-1',
  companyName: 'Acme Corp',
  legalEntityName: 'Acme Corporation',
  dba: 'Acme',
  address: '123 Main St',
  city: 'Springfield',
  state: 'IL',
  zip: '62701',
  phone: '555-0100',
  email: 'info@acme.com',
  ein: '12-3456789',
  uei: 'ABC123',
  cage: 'XYZ99',
  primaryNaics: '541511',
  entityType: 'LLC',
  website: 'acme.com',
  updatedAt: '2024-01-01T00:00:00Z',
};

describe('form-field-matcher', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInvokeModel.mockReset();
  });

  it('marks signature fields as MANUAL_REQUIRED without LLM call', async () => {
    const fields = [makeField({ fieldId: 'sig1', label: 'Authorized Signature' })];

    const results = await matchFieldsToProfile(fields, baseProfile);

    expect(results).toHaveLength(1);
    expect(results[0]!.manualReason).toContain('signature');
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('marks contract number fields as MANUAL_REQUIRED', async () => {
    const fields = [makeField({ fieldId: 'cn1', label: 'Contract No.' })];

    const results = await matchFieldsToProfile(fields, baseProfile);

    expect(results).toHaveLength(1);
    expect(results[0]!.manualReason).toContain('Opportunity-specific');
  });

  it('passes non-manual fields to LLM for matching', async () => {
    const fields = [
      makeField({ fieldId: 'f1', label: 'Company Name' }),
      makeField({ fieldId: 'f2', label: 'Phone Number' }),
    ];

    mockInvokeModel.mockResolvedValue(makeBedrockResponse({
      matches: [
        { fieldId: 'f1', profileFieldKey: 'companyName', confidence: 0.95 },
        { fieldId: 'f2', profileFieldKey: 'phone', confidence: 0.9 },
      ],
    }));

    const results = await matchFieldsToProfile(fields, baseProfile);

    expect(results[0]!.value).toBe('Acme Corp');
    expect(results[0]!.profileFieldKey).toBe('companyName');
    expect(results[0]!.confidence).toBe(0.95);
    expect(results[1]!.value).toBe('555-0100');
  });

  it('sets low confidence matches with value but below threshold', async () => {
    const fields = [makeField({ fieldId: 'f1', label: 'Vendor' })];

    mockInvokeModel.mockResolvedValue(makeBedrockResponse({
      matches: [
        { fieldId: 'f1', profileFieldKey: 'companyName', confidence: 0.7 },
      ],
    }));

    const results = await matchFieldsToProfile(fields, baseProfile);

    expect(results[0]!.value).toBe('Acme Corp');
    expect(results[0]!.confidence).toBe(0.7);
  });

  it('handles LLM failure gracefully', async () => {
    const fields = [makeField({ fieldId: 'f1', label: 'City' })];
    mockInvokeModel.mockRejectedValue(new Error('Bedrock timeout'));

    const results = await matchFieldsToProfile(fields, baseProfile);

    expect(results).toHaveLength(1);
    expect(results[0]!.value).toBeNull();
    expect(results[0]!.confidence).toBe(0);
  });

  it('returns empty matches for fields already MANUAL_REQUIRED', async () => {
    const fields = [makeField({ fieldId: 'f1', label: 'Date', status: 'MANUAL_REQUIRED', manualReason: 'Existing reason' })];

    const results = await matchFieldsToProfile(fields, baseProfile);

    expect(results[0]!.manualReason).toBe('Existing reason');
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('resolves authorizedSignatory fields', async () => {
    const profileWithSignatory = {
      ...baseProfile,
      authorizedSignatory: { name: 'John Doe', title: 'CEO' },
    };
    const fields = [makeField({ fieldId: 'f1', label: 'Signatory Name' })];

    mockInvokeModel.mockResolvedValue(makeBedrockResponse({
      matches: [
        { fieldId: 'f1', profileFieldKey: 'authorizedSignatory.name', confidence: 0.92 },
      ],
    }));

    const results = await matchFieldsToProfile(fields, profileWithSignatory);

    expect(results[0]!.value).toBe('John Doe');
  });
});
