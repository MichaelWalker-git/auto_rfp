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

const mockAttachFormAsRfpDocument = jest.fn();
const mockDetachFormFromProposal = jest.fn();
jest.mock('@/helpers/required-form-proposal-bridge', () => ({
  attachFormAsRfpDocument: (...args: unknown[]) => mockAttachFormAsRfpDocument(...args),
  detachFormFromProposal: (...args: unknown[]) => mockDetachFormFromProposal(...args),
}));

const mockSnapshotFormFields = jest.fn();
jest.mock('@/helpers/required-form-version', () => ({
  snapshotFormFields: (...args: unknown[]) => mockSnapshotFormFields(...args),
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
  getUserId: () => 'user-1',
  // Mirror the real parseJsonBody: takes the event, returns the parsed value or
  // `undefined` on malformed JSON (absent body → {}).
  parseJsonBody: (event: { body?: string | null }) => {
    if (!event.body) return {};
    try {
      return JSON.parse(event.body);
    } catch {
      return undefined;
    }
  },
}));

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { DetectedFormField } from '@auto-rfp/core';
import { baseHandler } from './save-form-fields';

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

const validBody = (overrides: Record<string, unknown> = {}) => ({
  orgId: 'org',
  projectId: 'p',
  opportunityId: 'o',
  formId: 'f',
  fields: [buildField({ status: 'AUTO_FILLED', value: 'a' }), buildField({ fieldId: 'f2', status: 'MANUAL_REQUIRED' })],
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('save-form-fields', () => {
  it('returns 400 when orgId is missing', async () => {
    const event = { body: JSON.stringify({ projectId: 'p' }) } as unknown as APIGatewayProxyEventV2;
    const res = await baseHandler(event);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 on invalid payload', async () => {
    const res = await baseHandler(eventFor({ orgId: 'org' }));
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 (not 500) on malformed JSON body', async () => {
    const event = {
      body: '{ not: valid json',
      queryStringParameters: { orgId: 'org' },
    } as unknown as APIGatewayProxyEventV2;
    const res = await baseHandler(event);
    expect(res.statusCode).toBe(400);
    expect(mockGetForm).not.toHaveBeenCalled();
  });

  it('returns 404 when form is not found', async () => {
    mockGetForm.mockResolvedValueOnce(null);
    const res = await baseHandler(eventFor(validBody()));
    expect(res.statusCode).toBe(404);
  });

  it('persists fields and recomputes counts (autoFill/manual/total) without auto-attaching', async () => {
    mockGetForm.mockResolvedValueOnce({
      formId: 'f', status: 'READY', attachedToProposal: false, proposalDocumentId: null,
    });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f' });

    const res = await baseHandler(eventFor(validBody()));
    expect(res.statusCode).toBe(200);
    expect(mockAttachFormAsRfpDocument).not.toHaveBeenCalled();

    const patch = mockUpdateForm.mock.calls[0][0].patch;
    expect(patch.totalFieldCount).toBe(2);
    expect(patch.manualFieldCount).toBe(1);
    expect(patch.autoFillPercentage).toBe(50);
    expect(patch).not.toHaveProperty('attachedToProposal');
    expect(patch).not.toHaveProperty('proposalDocumentId');
  });

  it('auto-attaches the form when status transitions to DONE for the first time', async () => {
    mockGetForm.mockResolvedValueOnce({
      formId: 'f', status: 'READY', attachedToProposal: false, proposalDocumentId: null,
    });
    mockAttachFormAsRfpDocument.mockResolvedValueOnce('rfp-doc-42');
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f' });

    const res = await baseHandler(eventFor(validBody({ status: 'DONE' })));

    expect(res.statusCode).toBe(200);
    expect(mockAttachFormAsRfpDocument).toHaveBeenCalledTimes(1);
    expect(mockAttachFormAsRfpDocument).toHaveBeenCalledWith({
      form: expect.any(Object),
      userId: 'user-1',
    });
    const patch = mockUpdateForm.mock.calls[0][0].patch;
    expect(patch.status).toBe('DONE');
    expect(patch.attachedToProposal).toBe(true);
    expect(patch.attachedAt).toEqual(expect.any(String));
    expect(patch.proposalDocumentId).toBe('rfp-doc-42');
  });

  it('does NOT re-attach when status is already DONE', async () => {
    mockGetForm.mockResolvedValueOnce({
      formId: 'f', status: 'DONE', attachedToProposal: true, proposalDocumentId: 'rfp-1',
    });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f' });

    await baseHandler(eventFor(validBody({ status: 'DONE' })));

    expect(mockAttachFormAsRfpDocument).not.toHaveBeenCalled();
    const patch = mockUpdateForm.mock.calls[0][0].patch;
    expect(patch).not.toHaveProperty('attachedToProposal');
    expect(patch).not.toHaveProperty('proposalDocumentId');
  });

  it('does NOT auto-attach when the user previously detached the form', async () => {
    mockGetForm.mockResolvedValueOnce({
      formId: 'f', status: 'READY', attachedToProposal: false, proposalDocumentId: 'rfp-prev',
    });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f' });

    await baseHandler(eventFor(validBody({ status: 'DONE' })));

    expect(mockAttachFormAsRfpDocument).not.toHaveBeenCalled();
  });

  it('does NOT auto-attach when the form is already attached (idempotent transition)', async () => {
    mockGetForm.mockResolvedValueOnce({
      formId: 'f', status: 'READY', attachedToProposal: true, proposalDocumentId: 'rfp-prev',
    });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f' });

    await baseHandler(eventFor(validBody({ status: 'DONE' })));

    expect(mockAttachFormAsRfpDocument).not.toHaveBeenCalled();
  });

  it('persists mark fields (markType/markChar/markGeometry) on the field array', async () => {
    mockGetForm.mockResolvedValueOnce({ formId: 'f', status: 'READY', attachedToProposal: false, proposalDocumentId: null });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f' });

    const fields = [
      buildField({ markType: 'CHECKBOX', markChar: 'X', status: 'MANUAL_REQUIRED' }),
      buildField({
        fieldId: 'f2',
        markType: 'CIRCLE',
        markChar: '○',
        markGeometry: { cx: 0.4, cy: 0.6, radius: 0.05 },
        status: 'MANUAL_REQUIRED',
      }),
    ];
    await baseHandler(eventFor(validBody({ fields })));

    const patch = mockUpdateForm.mock.calls[0][0].patch;
    expect(patch.fields).toHaveLength(2);
    expect(patch.fields[0]).toMatchObject({ markType: 'CHECKBOX', markChar: 'X' });
    expect(patch.fields[1]).toMatchObject({
      markType: 'CIRCLE',
      markChar: '○',
      markGeometry: { cx: 0.4, cy: 0.6, radius: 0.05 },
    });
  });

  it('returns 0 autoFillPercentage when there are no fields', async () => {
    mockGetForm.mockResolvedValueOnce({ formId: 'f', status: 'READY', attachedToProposal: false, proposalDocumentId: null });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f' });

    await baseHandler(eventFor(validBody({ fields: [] })));

    const patch = mockUpdateForm.mock.calls[0][0].patch;
    expect(patch.totalFieldCount).toBe(0);
    expect(patch.autoFillPercentage).toBe(0);
    expect(patch.manualFieldCount).toBe(0);
  });

  it('snapshots the current fields (source MANUAL) before overwriting when the form already has fields', async () => {
    mockGetForm.mockResolvedValueOnce({
      formId: 'f', status: 'READY', attachedToProposal: false, proposalDocumentId: null,
      fields: [buildField({ value: 'old' })],
    });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f' });

    const res = await baseHandler(eventFor(validBody()));
    expect(res.statusCode).toBe(200);
    expect(mockSnapshotFormFields).toHaveBeenCalledTimes(1);
    expect(mockSnapshotFormFields).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'MANUAL', userId: 'user-1' }),
    );
  });

  it('does NOT snapshot on the first save (form has no fields yet)', async () => {
    mockGetForm.mockResolvedValueOnce({
      formId: 'f', status: 'READY', attachedToProposal: false, proposalDocumentId: null,
      fields: [],
    });
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f' });

    await baseHandler(eventFor(validBody()));
    expect(mockSnapshotFormFields).not.toHaveBeenCalled();
  });

  it('still saves when the snapshot fails (history is best-effort)', async () => {
    mockGetForm.mockResolvedValueOnce({
      formId: 'f', status: 'READY', attachedToProposal: false, proposalDocumentId: null,
      fields: [buildField({ value: 'old' })],
    });
    mockSnapshotFormFields.mockRejectedValueOnce(new Error('ddb down'));
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f' });

    const res = await baseHandler(eventFor(validBody()));
    expect(res.statusCode).toBe(200);
    expect(mockUpdateForm).toHaveBeenCalledTimes(1);
  });

  it('passes requireUnattached on the update when auto-attaching', async () => {
    mockGetForm.mockResolvedValueOnce({
      formId: 'f', status: 'READY', attachedToProposal: false, proposalDocumentId: null,
    });
    mockAttachFormAsRfpDocument.mockResolvedValueOnce('rfp-doc-1');
    mockUpdateForm.mockResolvedValueOnce({ formId: 'f' });

    await baseHandler(eventFor(validBody({ status: 'DONE' })));

    expect(mockUpdateForm.mock.calls[0][0].requireUnattached).toBe(true);
  });

  it('rolls back the bridge doc and returns 409 when a concurrent attach won the race', async () => {
    mockGetForm.mockResolvedValueOnce({
      formId: 'f', status: 'READY', attachedToProposal: false, proposalDocumentId: null,
    });
    mockAttachFormAsRfpDocument.mockResolvedValueOnce('rfp-doc-1');
    const conditionalErr = Object.assign(new Error('cond fail'), { name: 'ConditionalCheckFailedException' });
    mockUpdateForm.mockRejectedValueOnce(conditionalErr);
    mockDetachFormFromProposal.mockResolvedValueOnce(undefined);

    const res = await baseHandler(eventFor(validBody({ status: 'DONE' })));

    expect(res.statusCode).toBe(409);
    expect(mockDetachFormFromProposal).toHaveBeenCalledWith({
      projectId: 'p',
      opportunityId: 'o',
      proposalDocumentId: 'rfp-doc-1',
      userId: 'user-1',
    });
  });
});
