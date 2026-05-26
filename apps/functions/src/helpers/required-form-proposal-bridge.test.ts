jest.mock('uuid', () => ({ v4: () => 'doc-uuid-1' }));

const mockDocClientSend = jest.fn();
jest.mock('./db', () => ({
  docClient: { send: (...args: unknown[]) => mockDocClientSend(...args) },
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  UpdateCommand: jest.fn((params) => ({ type: 'Update', params })),
}));

jest.mock('./date', () => ({
  nowIso: () => '2026-05-21T00:00:00.000Z',
}));

const mockPutRFPDocument = jest.fn();
const mockSoftDeleteRFPDocument = jest.fn();
jest.mock('./rfp-document', () => ({
  putRFPDocument: (...args: unknown[]) => mockPutRFPDocument(...args),
  softDeleteRFPDocument: (...args: unknown[]) => mockSoftDeleteRFPDocument(...args),
  buildRFPDocumentSK: (projectId: string, opportunityId: string, documentId: string) =>
    `${projectId}#${opportunityId}#${documentId}`,
}));

import {
  attachFormAsRfpDocument,
  syncFormFilledFileToProposal,
  detachFormFromProposal,
} from './required-form-proposal-bridge';
import type { RequiredFormItem } from '@auto-rfp/core';

const baseForm = (overrides: Partial<RequiredFormItem> = {}): RequiredFormItem => ({
  formId: 'form-1',
  orgId: 'org',
  projectId: 'p',
  opportunityId: 'o',
  name: 'Tax Exemption',
  formType: 'PDF_SCANNED',
  status: 'DONE',
  sourceFileName: 'tax.pdf',
  sourceFileKey: 'org/p/o/required-forms/form-1/source.pdf',
  sourcePageRange: null,
  sourceSheetName: null,
  fields: [],
  filledFileKey: null,
  autoFillPercentage: 0,
  manualFieldCount: 0,
  totalFieldCount: 0,
  reviewRequired: true,
  reviewedBy: null,
  reviewedAt: null,
  errorMessage: null,
  attachedToProposal: false,
  attachedAt: null,
  proposalDocumentId: null,
  createdAt: '2026-05-21T00:00:00.000Z',
  updatedAt: '2026-05-21T00:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('attachFormAsRfpDocument', () => {
  it('creates an RFP document pointed at filledFileKey when one exists', async () => {
    const form = baseForm({
      filledFileKey: 'org/p/o/required-forms/form-1/filled.pdf',
    });
    mockPutRFPDocument.mockResolvedValueOnce(undefined);

    const documentId = await attachFormAsRfpDocument({ form, userId: 'user-1' });

    expect(documentId).toBe('doc-uuid-1');
    const item = mockPutRFPDocument.mock.calls[0][0];
    expect(item).toMatchObject({
      documentId: 'doc-uuid-1',
      projectId: 'p',
      opportunityId: 'o',
      orgId: 'org',
      name: 'Tax Exemption',
      documentType: 'OTHER',
      mimeType: 'application/pdf',
      originalFileName: 'tax.pdf',
      fileKey: 'org/p/o/required-forms/form-1/filled.pdf',
      createdBy: 'user-1',
      updatedBy: 'user-1',
      version: 1,
      signatureStatus: 'NOT_REQUIRED',
      linearSyncStatus: 'NOT_SYNCED',
      createdAt: '2026-05-21T00:00:00.000Z',
      updatedAt: '2026-05-21T00:00:00.000Z',
    });
    expect(item.sort_key).toBe('p#o#doc-uuid-1');
    expect(item).not.toHaveProperty('requiredFormId');
  });

  it('falls back to sourceFileKey when filledFileKey is null', async () => {
    const form = baseForm();
    mockPutRFPDocument.mockResolvedValueOnce(undefined);

    await attachFormAsRfpDocument({ form, userId: 'user-1' });

    expect(mockPutRFPDocument.mock.calls[0][0].fileKey).toBe(
      'org/p/o/required-forms/form-1/source.pdf',
    );
  });

  it('uses spreadsheet mime type for XLSX_MATRIX forms', async () => {
    const form = baseForm({ formType: 'XLSX_MATRIX' });
    mockPutRFPDocument.mockResolvedValueOnce(undefined);

    await attachFormAsRfpDocument({ form, userId: 'user-1' });

    expect(mockPutRFPDocument.mock.calls[0][0].mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });

  it('uses spreadsheet mime type for XLSX_FORM forms', async () => {
    const form = baseForm({ formType: 'XLSX_FORM' });
    mockPutRFPDocument.mockResolvedValueOnce(undefined);

    await attachFormAsRfpDocument({ form, userId: 'user-1' });

    expect(mockPutRFPDocument.mock.calls[0][0].mimeType).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  });
});

describe('syncFormFilledFileToProposal', () => {
  it('is a silent no-op when proposalDocumentId is null', async () => {
    await syncFormFilledFileToProposal({
      projectId: 'p', opportunityId: 'o',
      proposalDocumentId: null,
      filledFileKey: 'org/p/o/required-forms/form-1/filled.pdf',
      userId: 'user-1',
    });
    expect(mockDocClientSend).not.toHaveBeenCalled();
  });

  it('updates the bridge RFP doc fileKey when proposalDocumentId is set', async () => {
    mockDocClientSend.mockResolvedValueOnce(undefined);
    await syncFormFilledFileToProposal({
      projectId: 'p', opportunityId: 'o',
      proposalDocumentId: 'rfp-doc-1',
      filledFileKey: 'org/p/o/required-forms/form-1/filled.pdf',
      userId: 'user-1',
    });

    expect(mockDocClientSend).toHaveBeenCalledTimes(1);
    const cmdParams = mockDocClientSend.mock.calls[0][0].params;
    expect(cmdParams.Key.sort_key).toBe('p#o#rfp-doc-1');
    expect(cmdParams.ExpressionAttributeValues[':fileKey']).toBe(
      'org/p/o/required-forms/form-1/filled.pdf',
    );
    expect(cmdParams.ExpressionAttributeValues[':updatedBy']).toBe('user-1');
  });

  it('uses a ConditionExpression that prevents resurrecting a missing or soft-deleted bridge doc', async () => {
    mockDocClientSend.mockResolvedValueOnce(undefined);
    await syncFormFilledFileToProposal({
      projectId: 'p', opportunityId: 'o',
      proposalDocumentId: 'rfp-doc-1',
      filledFileKey: 'k',
      userId: 'user-1',
    });

    const cmdParams = mockDocClientSend.mock.calls[0][0].params;
    expect(cmdParams.ConditionExpression).toBe('attribute_exists(#pk) AND #deletedAt = :null');
    expect(cmdParams.ExpressionAttributeNames['#deletedAt']).toBe('deletedAt');
    expect(cmdParams.ExpressionAttributeValues[':null']).toBeNull();
  });

  it('swallows ConditionalCheckFailed when the bridge doc no longer exists or is soft-deleted', async () => {
    const conditionalErr = Object.assign(new Error('cond fail'), { name: 'ConditionalCheckFailedException' });
    mockDocClientSend.mockRejectedValueOnce(conditionalErr);

    await expect(syncFormFilledFileToProposal({
      projectId: 'p', opportunityId: 'o',
      proposalDocumentId: 'rfp-doc-1',
      filledFileKey: 'k',
      userId: 'user-1',
    })).resolves.toBeUndefined();
  });

  it('swallows errors so a failed sync does not break export flow', async () => {
    mockDocClientSend.mockRejectedValueOnce(new Error('throttled'));
    await expect(syncFormFilledFileToProposal({
      projectId: 'p', opportunityId: 'o',
      proposalDocumentId: 'rfp-doc-1',
      filledFileKey: 'k',
      userId: 'user-1',
    })).resolves.toBeUndefined();
  });
});

describe('detachFormFromProposal', () => {
  it('is a silent no-op when proposalDocumentId is null', async () => {
    await detachFormFromProposal({
      projectId: 'p', opportunityId: 'o',
      proposalDocumentId: null, userId: 'user-1',
    });
    expect(mockSoftDeleteRFPDocument).not.toHaveBeenCalled();
  });

  it('soft-deletes the bridge RFP doc when proposalDocumentId is set', async () => {
    mockSoftDeleteRFPDocument.mockResolvedValueOnce(undefined);
    await detachFormFromProposal({
      projectId: 'p', opportunityId: 'o',
      proposalDocumentId: 'rfp-doc-1', userId: 'user-1',
    });
    expect(mockSoftDeleteRFPDocument).toHaveBeenCalledWith({
      projectId: 'p', opportunityId: 'o',
      documentId: 'rfp-doc-1', deletedBy: 'user-1',
    });
  });

  it('swallows errors (idempotent) when soft-delete throws', async () => {
    mockSoftDeleteRFPDocument.mockRejectedValueOnce(new Error('not found'));
    await expect(detachFormFromProposal({
      projectId: 'p', opportunityId: 'o',
      proposalDocumentId: 'rfp-doc-1', userId: 'user-1',
    })).resolves.toBeUndefined();
  });
});
