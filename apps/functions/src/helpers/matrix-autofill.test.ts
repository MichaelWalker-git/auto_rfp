jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (handler: unknown) => handler,
}));

const mockInvokeModel = jest.fn();
jest.mock('./bedrock-http-client', () => ({
  invokeModel: (...args: unknown[]) => mockInvokeModel(...args),
}));

const mockGetCompanyProfile = jest.fn();
jest.mock('./company-profile', () => ({
  getCompanyProfile: (...args: unknown[]) => mockGetCompanyProfile(...args),
}));

process.env.BEDROCK_MODEL_ID = 'test-model';
process.env.BEDROCK_API_KEY_SSM_PARAM = '/auto-rfp/bedrock/api-key';

import { autofillMatrixComments } from './matrix-autofill';
import type { DetectedFormField } from '@auto-rfp/core';

const buildField = (overrides: Partial<DetectedFormField> = {}): DetectedFormField => ({
  fieldId: 'f1',
  label: 'MFA support — Comments',
  value: null,
  status: 'EMPTY',
  confidence: null,
  profileFieldKey: null,
  manualReason: null,
  pageNumber: null,
  cellReference: 'E2',
  boundingBox: null,
  markType: 'TEXT',
  markChar: null,
  markGeometry: null,
  matrixCategory: 'Cybersecurity',
  matrixFeature: 'MFA support',
  matrixColumn: 'COMMENTS',
  ...overrides,
});

const modelResponse = (responses: Array<{ fieldId: string; value: string | null; confidence: number }>) => {
  const text = JSON.stringify({ responses });
  const body = JSON.stringify({ content: [{ type: 'text', text }] });
  return new TextEncoder().encode(body);
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe('autofillMatrixComments', () => {
  it('returns fields untouched when there are no Comments targets', async () => {
    const fields = [buildField({ matrixColumn: 'FULLY_MEETS', status: 'MANUAL_REQUIRED' })];
    const result = await autofillMatrixComments({ orgId: 'org1', fields });
    expect(result).toEqual(fields);
    expect(mockGetCompanyProfile).not.toHaveBeenCalled();
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('returns fields untouched when the org has no CAPABILITY entries', async () => {
    mockGetCompanyProfile.mockResolvedValue({
      fields: [
        { key: 'ein', label: 'EIN', value: '12-3456789', category: 'IDENTITY' },
      ],
    });
    const fields = [buildField()];
    const result = await autofillMatrixComments({ orgId: 'org1', fields });
    expect(result).toEqual(fields);
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('populates COMMENTS fields when Bedrock returns a confident response', async () => {
    mockGetCompanyProfile.mockResolvedValue({
      fields: [
        {
          key: 'mfa', label: 'MFA support', value: 'Cognito + WebAuthn enforced',
          category: 'CAPABILITY', notes: null,
        },
      ],
    });
    mockInvokeModel.mockResolvedValue(
      modelResponse([{ fieldId: 'f1', value: 'Horus enforces MFA via Cognito + WebAuthn.', confidence: 0.9 }]),
    );

    const fields = [buildField()];
    const [updated] = await autofillMatrixComments({ orgId: 'org1', fields });

    expect(updated.value).toBe('Horus enforces MFA via Cognito + WebAuthn.');
    expect(updated.status).toBe('AUTO_FILLED');
    expect(updated.confidence).toBe(0.9);
  });

  it('leaves fields empty when Bedrock confidence is below threshold', async () => {
    mockGetCompanyProfile.mockResolvedValue({
      fields: [
        { key: 'cap', label: 'Some capability', value: '...', category: 'CAPABILITY', notes: null },
      ],
    });
    mockInvokeModel.mockResolvedValue(
      modelResponse([{ fieldId: 'f1', value: 'maybe', confidence: 0.2 }]),
    );

    const fields = [buildField()];
    const [updated] = await autofillMatrixComments({ orgId: 'org1', fields });

    expect(updated.value).toBeNull();
    expect(updated.status).toBe('EMPTY');
  });

  it('falls back to original fields when Bedrock throws', async () => {
    mockGetCompanyProfile.mockResolvedValue({
      fields: [
        { key: 'cap', label: 'Some capability', value: '...', category: 'CAPABILITY', notes: null },
      ],
    });
    mockInvokeModel.mockRejectedValue(new Error('bedrock down'));

    const fields = [buildField()];
    const result = await autofillMatrixComments({ orgId: 'org1', fields });
    expect(result).toEqual(fields);
  });

  it('does not touch fields with status !== EMPTY', async () => {
    mockGetCompanyProfile.mockResolvedValue({
      fields: [
        { key: 'cap', label: 'X', value: 'Y', category: 'CAPABILITY', notes: null },
      ],
    });
    mockInvokeModel.mockResolvedValue(modelResponse([]));

    const fields = [
      buildField({ status: 'AUTO_FILLED', value: 'preset' }),
      buildField({ fieldId: 'f2', status: 'EMPTY' }),
    ];
    const result = await autofillMatrixComments({ orgId: 'org1', fields });
    // Bedrock was invoked with only the EMPTY field; preset stays intact.
    expect(result[0].value).toBe('preset');
    expect(result[0].status).toBe('AUTO_FILLED');
  });
});
