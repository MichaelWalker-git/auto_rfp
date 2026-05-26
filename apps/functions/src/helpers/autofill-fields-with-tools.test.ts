jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({ use: jest.fn().mockReturnThis(), handler });
  return { __esModule: true, default: middy };
});

jest.mock('@aws-sdk/client-dynamodb', () => ({ DynamoDBClient: jest.fn(() => ({})) }));
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: jest.fn(() => ({ send: jest.fn() })) },
}));

const mockInvokeWithTools = jest.fn();
jest.mock('./bedrock-tool-loop', () => ({
  invokeClaudeWithTools: (...args: unknown[]) => mockInvokeWithTools(...args),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.BEDROCK_MODEL_ID = 'anthropic.claude-test';

import { autofillFieldsWithTools } from './autofill-fields-with-tools';
import type { CompanyProfileItem, DetectedFormField } from '@auto-rfp/core';

const baseField = (overrides: Partial<DetectedFormField>): DetectedFormField => ({
  fieldId: overrides.fieldId ?? 'f-1',
  label: overrides.label ?? 'Company Name',
  value: overrides.value ?? null,
  status: overrides.status ?? 'EMPTY',
  confidence: overrides.confidence ?? null,
  profileFieldKey: overrides.profileFieldKey ?? null,
  manualReason: overrides.manualReason ?? null,
  pageNumber: overrides.pageNumber ?? 1,
  cellReference: overrides.cellReference ?? null,
  boundingBox: overrides.boundingBox ?? null,
});

const profile: CompanyProfileItem = {
  orgId: 'org-1',
  companyName: 'Acme Corp',
  legalEntityName: null,
  dba: null,
  address: '1 Main St',
  city: 'Toledo',
  state: 'OH',
  zip: '43604',
  phone: null,
  email: 'contact@acme.example',
  website: null,
  ein: '12-3456789',
  uei: null,
  cage: null,
  primaryNaics: null,
  secondaryNaics: [],
  entityType: 'LLC',
  stateEntityNumber: null,
  smallBusinessCertId: null,
  smallBusinessCertExpiration: null,
  fields: [],
  authorizedSignatory: { name: 'Nates Ben', title: 'Director' },
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockInvokeWithTools.mockReset();
});

describe('autofillFieldsWithTools', () => {
  it('returns the input unchanged when given an empty list', async () => {
    const result = await autofillFieldsWithTools([], profile);
    expect(result).toEqual([]);
    expect(mockInvokeWithTools).not.toHaveBeenCalled();
  });

  it("auto-fills 'Date' fields with today's date in MM/DD/YYYY without invoking the model", async () => {
    const fields = [
      baseField({ fieldId: 'd1', label: 'Date' }),
      baseField({ fieldId: 'd2', label: 'Date Signed' }),
      baseField({ fieldId: 'd3', label: 'Effective Date' }), // NOT a today field
    ];
    const result = await autofillFieldsWithTools(fields, profile);

    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const expected = `${mm}/${dd}/${today.getFullYear()}`;

    expect(result[0]).toMatchObject({ value: expected, status: 'AUTO_FILLED', profileFieldKey: 'today' });
    expect(result[1]).toMatchObject({ value: expected, status: 'AUTO_FILLED' });
    // Effective Date should still be passed to the LLM (no model mock here so it stays EMPTY).
    expect(result[2].value).toBeNull();
  });

  it('pre-marks signature/initial/notary fields as MANUAL_REQUIRED without invoking the model', async () => {
    const fields = [
      baseField({ fieldId: 'sig', label: 'Authorized Signature' }),
      baseField({ fieldId: 'init', label: 'Initials' }),
      baseField({ fieldId: 'not', label: 'Notary Public' }),
    ];
    const result = await autofillFieldsWithTools(fields, profile);
    expect(mockInvokeWithTools).not.toHaveBeenCalled();
    expect(result.map((f) => f.status)).toEqual(['MANUAL_REQUIRED', 'MANUAL_REQUIRED', 'MANUAL_REQUIRED']);
    expect(result[0].manualReason).toMatch(/signature/i);
  });

  it('AUTO_FILLs a field when the model calls fill_field with high confidence and a real profile key', async () => {
    const fields = [baseField({ fieldId: 'f-name', label: 'Vendor Name' })];
    mockInvokeWithTools.mockImplementation(async (args: { toolExecutor: Function }) => {
      await args.toolExecutor(
        'fill_field',
        { fieldId: 'f-name', value: 'Acme Corp', profileFieldKey: 'companyName', confidence: 0.92 },
        'tool-1',
      );
      return { ok: true };
    });

    const result = await autofillFieldsWithTools(fields, profile);
    expect(result[0]).toMatchObject({
      value: 'Acme Corp',
      status: 'AUTO_FILLED',
      confidence: 0.92,
      profileFieldKey: 'companyName',
    });
  });

  it('downgrades to LOW_CONFIDENCE when confidence is between 0.5 and 0.7', async () => {
    const fields = [baseField({ fieldId: 'f-addr', label: 'Mailing Address' })];
    mockInvokeWithTools.mockImplementation(async (args: { toolExecutor: Function }) => {
      await args.toolExecutor(
        'fill_field',
        { fieldId: 'f-addr', value: '1 Main St', profileFieldKey: 'address', confidence: 0.6 },
        't',
      );
      return { ok: true };
    });

    const result = await autofillFieldsWithTools(fields, profile);
    expect(result[0]).toMatchObject({ status: 'LOW_CONFIDENCE', value: '1 Main St', confidence: 0.6 });
  });

  it('marks fields manual when fill_field is called with a profileFieldKey that does not exist on the profile', async () => {
    const fields = [baseField({ fieldId: 'f-cage', label: 'CAGE Code' })];
    mockInvokeWithTools.mockImplementation(async (args: { toolExecutor: Function }) => {
      await args.toolExecutor(
        'fill_field',
        { fieldId: 'f-cage', value: 'XYZ12', profileFieldKey: 'cage', confidence: 0.95 },
        't',
      );
      return { ok: true };
    });

    const result = await autofillFieldsWithTools(fields, profile);
    expect(result[0].status).toBe('MANUAL_REQUIRED');
    expect(result[0].manualReason).toMatch(/no profile value/i);
  });

  it('uses values resolved from nested keys (authorizedSignatory.name, fields.<key>)', async () => {
    const fields = [baseField({ fieldId: 'f-printed', label: 'Name Printed' })];
    mockInvokeWithTools.mockImplementation(async (args: { toolExecutor: Function }) => {
      await args.toolExecutor(
        'fill_field',
        { fieldId: 'f-printed', value: 'Nates Ben', profileFieldKey: 'authorizedSignatory.name', confidence: 0.9 },
        't',
      );
      return { ok: true };
    });

    const result = await autofillFieldsWithTools(fields, profile);
    expect(result[0]).toMatchObject({ status: 'AUTO_FILLED', value: 'Nates Ben' });
  });

  it('honors mark_manual decisions from the model with the provided reason', async () => {
    const fields = [baseField({ fieldId: 'f-amb', label: 'Reference' })];
    mockInvokeWithTools.mockImplementation(async (args: { toolExecutor: Function }) => {
      await args.toolExecutor('mark_manual', { fieldId: 'f-amb', reason: 'No profile value applies' }, 't');
      return { ok: true };
    });

    const result = await autofillFieldsWithTools(fields, profile);
    expect(result[0]).toMatchObject({ status: 'MANUAL_REQUIRED', manualReason: 'No profile value applies' });
  });

  it('leaves fields the model never addressed in their original state', async () => {
    const fields = [
      baseField({ fieldId: 'a', label: 'City' }),
      baseField({ fieldId: 'b', label: 'State' }),
    ];
    mockInvokeWithTools.mockImplementation(async (args: { toolExecutor: Function }) => {
      await args.toolExecutor(
        'fill_field',
        { fieldId: 'a', value: 'Toledo', profileFieldKey: 'city', confidence: 0.85 },
        't',
      );
      return { ok: true };
    });
    const result = await autofillFieldsWithTools(fields, profile);
    expect(result[0].status).toBe('AUTO_FILLED');
    expect(result[1].status).toBe('EMPTY');
  });

  it('returns input unchanged when the model loop throws', async () => {
    mockInvokeWithTools.mockRejectedValueOnce(new Error('bedrock down'));
    const fields = [baseField({ fieldId: 'a', label: 'City' })];
    const result = await autofillFieldsWithTools(fields, profile);
    expect(result[0].status).toBe('EMPTY');
  });
});
