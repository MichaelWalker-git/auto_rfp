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

jest.mock('@/helpers/api', () => ({
  apiResponse: (statusCode: number, body: unknown) => ({ statusCode, body: JSON.stringify(body) }),
  getOrgId: (event: { queryStringParameters?: Record<string, string>; body?: string | null }) => {
    if (event.queryStringParameters?.orgId) return event.queryStringParameters.orgId;
    if (event.body) {
      try {
        const b = JSON.parse(event.body);
        return b.orgId;
      } catch {
        return undefined;
      }
    }
    return undefined;
  },
}));

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { DetectedFormField } from '@auto-rfp/core';
import { baseHandler } from './update-form-field';

const buildField = (overrides: Partial<DetectedFormField> = {}): DetectedFormField => ({
  fieldId: 'f1',
  label: 'Field',
  value: null,
  status: 'EMPTY',
  confidence: null,
  profileFieldKey: null,
  manualReason: null,
  pageNumber: null,
  cellReference: null,
  boundingBox: null,
  markType: 'TEXT',
  markChar: null,
  markGeometry: null,
  matrixCategory: null,
  matrixFeature: null,
  matrixColumn: 'OTHER',
  ...overrides,
});

const eventFor = (body: Record<string, unknown>): APIGatewayProxyEventV2 =>
  ({
    body: JSON.stringify(body),
    queryStringParameters: { orgId: body.orgId as string | undefined },
  } as unknown as APIGatewayProxyEventV2);

const baseBody = (overrides: Record<string, unknown> = {}) => ({
  orgId: 'org', projectId: 'p', opportunityId: 'o',
  formId: 'f1', fieldId: 'field-1',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('update-form-field', () => {
  it('returns 400 when orgId is missing', async () => {
    const event = { body: JSON.stringify({ projectId: 'p' }) } as unknown as APIGatewayProxyEventV2;
    const res = await baseHandler(event);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 on invalid payload', async () => {
    const res = await baseHandler(eventFor({ orgId: 'org' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when form is missing', async () => {
    mockGetForm.mockResolvedValueOnce(null);
    const res = await baseHandler(eventFor(baseBody()));
    expect(res.statusCode).toBe(404);
  });

  it('updates an existing TEXT field value and derives status', async () => {
    mockGetForm.mockResolvedValueOnce({
      formId: 'f1',
      fields: [buildField({ fieldId: 'field-1', value: 'old', status: 'AUTO_FILLED' })],
    });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f1' });

    await baseHandler(eventFor(baseBody({ value: 'new value' })));

    const patch = mockUpdateForm.mock.calls[0][0].patch;
    expect(patch.fields[0]).toMatchObject({ value: 'new value', status: 'AUTO_FILLED' });
  });

  it('clears status to EMPTY when value is set to empty string on a non-manual field', async () => {
    mockGetForm.mockResolvedValueOnce({
      formId: 'f1',
      fields: [buildField({ fieldId: 'field-1', value: 'hello', status: 'AUTO_FILLED' })],
    });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f1' });

    await baseHandler(eventFor(baseBody({ value: '' })));

    const patch = mockUpdateForm.mock.calls[0][0].patch;
    expect(patch.fields[0]).toMatchObject({ value: '', status: 'EMPTY' });
  });

  it('preserves MANUAL_REQUIRED status when the user clears the value', async () => {
    mockGetForm.mockResolvedValueOnce({
      formId: 'f1',
      fields: [buildField({
        fieldId: 'field-1',
        value: 'partial answer',
        status: 'MANUAL_REQUIRED',
        manualReason: 'Compliance determination requires manual review',
      })],
    });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f1' });

    await baseHandler(eventFor(baseBody({ value: '' })));

    const patch = mockUpdateForm.mock.calls[0][0].patch;
    expect(patch.fields[0]).toMatchObject({
      value: '',
      status: 'MANUAL_REQUIRED',
    });
  });

  it('still allows an explicit status override on a MANUAL_REQUIRED field', async () => {
    mockGetForm.mockResolvedValueOnce({
      formId: 'f1',
      fields: [buildField({
        fieldId: 'field-1',
        value: null,
        status: 'MANUAL_REQUIRED',
      })],
    });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f1' });

    await baseHandler(eventFor(baseBody({ value: 'final answer', status: 'AUTO_FILLED' })));

    const patch = mockUpdateForm.mock.calls[0][0].patch;
    expect(patch.fields[0]).toMatchObject({
      value: 'final answer',
      status: 'AUTO_FILLED',
    });
  });

  it('updates mark fields (markType, markChar, markGeometry)', async () => {
    mockGetForm.mockResolvedValueOnce({
      formId: 'f1',
      fields: [buildField({ fieldId: 'field-1' })],
    });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f1' });

    await baseHandler(eventFor(baseBody({
      markType: 'CIRCLE',
      markChar: '○',
      markGeometry: { cx: 0.5, cy: 0.5, radius: 0.05 },
    })));

    const patch = mockUpdateForm.mock.calls[0][0].patch;
    expect(patch.fields[0]).toMatchObject({
      markType: 'CIRCLE',
      markChar: '○',
      markGeometry: { cx: 0.5, cy: 0.5, radius: 0.05 },
    });
  });

  it('toggles a checkbox markChar back to null without overwriting other props', async () => {
    mockGetForm.mockResolvedValueOnce({
      formId: 'f1',
      fields: [buildField({
        fieldId: 'field-1', label: 'Audit logging',
        markType: 'CHECKBOX', markChar: 'X',
      })],
    });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f1' });

    await baseHandler(eventFor(baseBody({ markChar: null })));

    const patch = mockUpdateForm.mock.calls[0][0].patch;
    expect(patch.fields[0]).toMatchObject({
      label: 'Audit logging',
      markType: 'CHECKBOX',
      markChar: null,
    });
  });

  it('creates a new field when fieldId is unknown — defaults markType TEXT, matrixColumn OTHER', async () => {
    mockGetForm.mockResolvedValueOnce({ formId: 'f1', fields: [] });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f1' });

    await baseHandler(eventFor(baseBody({ fieldId: 'newField', label: 'New', value: 'v' })));

    const patch = mockUpdateForm.mock.calls[0][0].patch;
    expect(patch.fields).toHaveLength(1);
    expect(patch.fields[0]).toMatchObject({
      fieldId: 'newField',
      label: 'New',
      value: 'v',
      status: 'AUTO_FILLED',
      markType: 'TEXT',
      matrixColumn: 'OTHER',
    });
  });

  it('creates a new CIRCLE field with mark metadata when markType is provided', async () => {
    mockGetForm.mockResolvedValueOnce({ formId: 'f1', fields: [] });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f1' });

    await baseHandler(eventFor(baseBody({
      fieldId: 'newCircle',
      markType: 'CIRCLE',
      markChar: '○',
      markGeometry: { cx: 0.4, cy: 0.4, radius: 0.05 },
    })));

    const patch = mockUpdateForm.mock.calls[0][0].patch;
    expect(patch.fields[0]).toMatchObject({
      fieldId: 'newCircle',
      markType: 'CIRCLE',
      markChar: '○',
      markGeometry: { cx: 0.4, cy: 0.4, radius: 0.05 },
      status: 'EMPTY',
    });
  });

  it('removes a field when delete: true is set', async () => {
    mockGetForm.mockResolvedValueOnce({
      formId: 'f1',
      fields: [
        buildField({ fieldId: 'field-1' }),
        buildField({ fieldId: 'keep' }),
      ],
    });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f1' });

    await baseHandler(eventFor(baseBody({ delete: true })));

    const patch = mockUpdateForm.mock.calls[0][0].patch;
    expect(patch.fields).toHaveLength(1);
    expect(patch.fields[0].fieldId).toBe('keep');
  });

  it('recomputes counts after the update', async () => {
    mockGetForm.mockResolvedValueOnce({
      formId: 'f1',
      fields: [
        buildField({ fieldId: 'field-1', status: 'EMPTY' }),
        buildField({ fieldId: 'field-2', status: 'MANUAL_REQUIRED' }),
        buildField({ fieldId: 'field-3', status: 'AUTO_FILLED' }),
      ],
    });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f1' });

    await baseHandler(eventFor(baseBody({ fieldId: 'field-1', value: 'now filled' })));

    const patch = mockUpdateForm.mock.calls[0][0].patch;
    expect(patch.totalFieldCount).toBe(3);
    expect(patch.manualFieldCount).toBe(1);
    expect(patch.autoFillPercentage).toBe(67);
  });
});
