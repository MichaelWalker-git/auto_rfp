/**
 * Guarded apply — the safety core. Verifies skip-on-stale and ambiguous-match
 * behavior for both document and form targets, and that a throw on one target
 * becomes a 'failed' result without aborting the batch.
 */
const mockGetRFPDocument = jest.fn();
const mockLoadHtml = jest.fn();
const mockUpdateDocWithContent = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  getRFPDocument: (...a: unknown[]) => mockGetRFPDocument(...a),
  loadRFPDocumentHtml: (...a: unknown[]) => mockLoadHtml(...a),
  updateRFPDocumentWithContent: (...a: unknown[]) => mockUpdateDocWithContent(...a),
}));

const mockGetLatestVersionNumber = jest.fn();
jest.mock('@/helpers/rfp-document-version', () => ({
  getLatestVersionNumber: (...a: unknown[]) => mockGetLatestVersionNumber(...a),
}));

const mockGetRequiredForm = jest.fn();
const mockUpdateRequiredForm = jest.fn();
jest.mock('@/helpers/required-form', () => ({
  getRequiredForm: (...a: unknown[]) => mockGetRequiredForm(...a),
  updateRequiredForm: (...a: unknown[]) => mockUpdateRequiredForm(...a),
}));

const mockSnapshotFormFields = jest.fn();
jest.mock('@/helpers/required-form-version', () => ({
  snapshotFormFields: (...a: unknown[]) => mockSnapshotFormFields(...a),
}));

const mockWriteQuestionnaireCells = jest.fn();
jest.mock('@/helpers/questionnaire-edit', () => ({
  writeQuestionnaireCells: (...a: unknown[]) => mockWriteQuestionnaireCells(...a),
}));

const mockSnapshotQuestionnaire = jest.fn();
jest.mock('@/helpers/questionnaire-version', () => ({
  snapshotQuestionnaire: (...a: unknown[]) => mockSnapshotQuestionnaire(...a),
  // Keep the real org guard so the M2 check behaves as in prod.
  docBelongsToOrg: (doc: { fileKey?: unknown; orgId?: unknown } | null, orgId: string) => {
    const fileKey = typeof doc?.fileKey === 'string' ? doc.fileKey : '';
    if (!fileKey.startsWith(`${orgId}/`)) return false;
    const docOrgId = typeof doc?.orgId === 'string' ? doc.orgId : undefined;
    return !docOrgId || docOrgId === orgId;
  },
}));

import type { ProposedEdit } from '@auto-rfp/core';
import { applyOneEdit, applyEdits } from './package-edit-apply';

const ctx = { orgId: 'o', projectId: 'p', oppId: 'opp', userId: 'u1' };

const docEdit = (over: Partial<ProposedEdit> = {}): ProposedEdit => ({
  editId: 'e-doc',
  target: { kind: 'RFP_DOCUMENT', documentId: 'doc-1', documentTitle: 'Tech' },
  before: 'total cost is $2.0M',
  after: 'total cost is $2.4M',
  rationale: 'align',
  advisoryOnly: false,
  ...over,
});

const formEdit = (over: Partial<ProposedEdit> = {}): ProposedEdit => ({
  editId: 'e-form',
  target: { kind: 'FORM', formId: 'form-1', fieldId: 'fld-1' },
  before: '$2.0M',
  after: '$2.4M',
  rationale: 'align',
  advisoryOnly: false,
  ...over,
});

const questionnaireEdit = (over: Partial<ProposedEdit> = {}): ProposedEdit => ({
  editId: 'e-q',
  target: { kind: 'QUESTIONNAIRE', documentId: 'q-1', documentTitle: 'Q', sheetName: 'Sheet1', row: 0, col: 1, ref: 'B1' },
  before: 'HORUSTECH',
  after: 'Horus Technology',
  rationale: 'canonical name',
  advisoryOnly: false,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockGetLatestVersionNumber.mockResolvedValue(5);
  mockSnapshotFormFields.mockResolvedValue(3);
  mockUpdateDocWithContent.mockResolvedValue({});
  mockUpdateRequiredForm.mockResolvedValue({});
  mockSnapshotQuestionnaire.mockResolvedValue(4);
  mockWriteQuestionnaireCells.mockResolvedValue({ results: [{ ref: 'B1', status: 'applied' }], wroteAny: true });
});

describe('document apply', () => {
  it('applies a single unique occurrence and returns the new version number', async () => {
    mockGetRFPDocument.mockResolvedValueOnce({ htmlContentKey: 'k', title: 'Tech', content: {} });
    mockLoadHtml.mockResolvedValueOnce('<p>The total cost is $2.0M in the base year.</p>');

    const res = await applyOneEdit(docEdit(), ctx);
    expect(res.status).toBe('applied');
    expect(res.newVersionNumber).toBe(5);
    // the saved HTML replaced the single occurrence
    const savedHtml = mockUpdateDocWithContent.mock.calls[0][0].dto.content.content;
    expect(savedHtml).toContain('total cost is $2.4M');
    expect(savedHtml).not.toContain('total cost is $2.0M');
  });

  it('skips as stale when the before text is no longer present', async () => {
    mockGetRFPDocument.mockResolvedValueOnce({ htmlContentKey: 'k', title: 'Tech', content: {} });
    mockLoadHtml.mockResolvedValueOnce('<p>The number changed already.</p>');

    const res = await applyOneEdit(docEdit(), ctx);
    expect(res.status).toBe('skipped-stale');
    expect(mockUpdateDocWithContent).not.toHaveBeenCalled();
  });

  it('skips as stale (ambiguous) when the before text matches more than once', async () => {
    mockGetRFPDocument.mockResolvedValueOnce({ htmlContentKey: 'k', title: 'Tech', content: {} });
    mockLoadHtml.mockResolvedValueOnce('<p>total cost is $2.0M ... total cost is $2.0M</p>');

    const res = await applyOneEdit(docEdit(), ctx);
    expect(res.status).toBe('skipped-stale');
    expect(res.message).toMatch(/ambiguous/i);
    expect(mockUpdateDocWithContent).not.toHaveBeenCalled();
  });

  it('skips as stale when the document is missing', async () => {
    mockGetRFPDocument.mockResolvedValueOnce(null);
    const res = await applyOneEdit(docEdit(), ctx);
    expect(res.status).toBe('skipped-stale');
  });

  it('reports failed when the write throws', async () => {
    mockGetRFPDocument.mockResolvedValueOnce({ htmlContentKey: 'k', title: 'Tech', content: {} });
    mockLoadHtml.mockResolvedValueOnce('<p>total cost is $2.0M</p>');
    mockUpdateDocWithContent.mockRejectedValueOnce(new Error('s3 down'));

    const res = await applyOneEdit(docEdit(), ctx);
    expect(res.status).toBe('failed');
    expect(res.message).toBe('s3 down');
  });
});

describe('form apply', () => {
  it('snapshots then writes when the field value matches before', async () => {
    mockGetRequiredForm.mockResolvedValueOnce({
      fields: [{ fieldId: 'fld-1', label: 'Total', value: '$2.0M' }],
    });

    const res = await applyOneEdit(formEdit(), ctx);
    expect(res.status).toBe('applied');
    expect(res.newVersionNumber).toBe(3);
    expect(mockSnapshotFormFields).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'AI_MASS_EDIT', userId: 'u1' }),
    );
    const patch = mockUpdateRequiredForm.mock.calls[0][0].patch;
    expect(patch.fields.find((f: { fieldId: string }) => f.fieldId === 'fld-1').value).toBe('$2.4M');
  });

  it('fills an EMPTY field (before="") — the guard treats "" vs empty as a match', async () => {
    mockGetRequiredForm.mockResolvedValueOnce({
      fields: [{ fieldId: 'fld-1', label: 'Primary Contact Name', value: null }],
    });
    const res = await applyOneEdit(
      formEdit({ before: '', after: 'Brennen Stones' }),
      ctx,
    );
    expect(res.status).toBe('applied');
    const patch = mockUpdateRequiredForm.mock.calls[0][0].patch;
    expect(patch.fields.find((f: { fieldId: string }) => f.fieldId === 'fld-1').value).toBe('Brennen Stones');
  });

  it('skips as stale when the field value changed since proposed', async () => {
    mockGetRequiredForm.mockResolvedValueOnce({
      fields: [{ fieldId: 'fld-1', label: 'Total', value: '$9.9M' }],
    });
    const res = await applyOneEdit(formEdit(), ctx);
    expect(res.status).toBe('skipped-stale');
    expect(mockUpdateRequiredForm).not.toHaveBeenCalled();
  });

  it('skips as stale when the field no longer exists', async () => {
    mockGetRequiredForm.mockResolvedValueOnce({ fields: [] });
    const res = await applyOneEdit(formEdit(), ctx);
    expect(res.status).toBe('skipped-stale');
  });

  it('still applies when the snapshot fails (history is best-effort)', async () => {
    mockGetRequiredForm.mockResolvedValueOnce({
      fields: [{ fieldId: 'fld-1', label: 'Total', value: '$2.0M' }],
    });
    mockSnapshotFormFields.mockRejectedValueOnce(new Error('snap down'));

    const res = await applyOneEdit(formEdit(), ctx);
    expect(res.status).toBe('applied');
    expect(mockUpdateRequiredForm).toHaveBeenCalledTimes(1);
  });
});

describe('questionnaire apply', () => {
  it('snapshots then writes the cell when the current value matches before', async () => {
    mockGetRFPDocument.mockResolvedValueOnce({ documentId: 'q-1', fileKey: 'o/p/opp/rfp-documents/q-1/live.xlsx' });

    const res = await applyOneEdit(questionnaireEdit(), ctx);
    expect(res.status).toBe('applied');
    expect(res.newVersionNumber).toBe(4);
    expect(mockSnapshotQuestionnaire).toHaveBeenCalledWith(
      expect.objectContaining({ documentId: 'q-1', currentFileKey: 'o/p/opp/rfp-documents/q-1/live.xlsx', source: 'AI_MASS_EDIT', userId: 'u1' }),
    );
    expect(mockWriteQuestionnaireCells).toHaveBeenCalledWith(
      expect.objectContaining({
        fileKey: 'o/p/opp/rfp-documents/q-1/live.xlsx',
        writes: [{ ref: 'B1', sheetName: 'Sheet1', before: 'HORUSTECH', after: 'Horus Technology' }],
      }),
    );
  });

  it('skips as stale when the writer reports the cell changed', async () => {
    mockGetRFPDocument.mockResolvedValueOnce({ documentId: 'q-1', fileKey: 'o/p/opp/rfp-documents/q-1/live.xlsx' });
    mockWriteQuestionnaireCells.mockResolvedValueOnce({
      results: [{ ref: 'B1', status: 'skipped-stale', message: 'Cell value changed since proposed' }],
      wroteAny: false,
    });

    const res = await applyOneEdit(questionnaireEdit(), ctx);
    expect(res.status).toBe('skipped-stale');
  });

  it('skips as stale when the questionnaire has no file', async () => {
    mockGetRFPDocument.mockResolvedValueOnce({ documentId: 'q-1', fileKey: null });
    const res = await applyOneEdit(questionnaireEdit(), ctx);
    expect(res.status).toBe('skipped-stale');
    expect(mockWriteQuestionnaireCells).not.toHaveBeenCalled();
  });

  it('M2: skips (no write) when the doc file belongs to a different org', async () => {
    mockGetRFPDocument.mockResolvedValueOnce({
      documentId: 'q-1', fileKey: 'other/p/opp/rfp-documents/q-1/live.xlsx', orgId: 'other',
    });
    const res = await applyOneEdit(questionnaireEdit(), ctx);
    expect(res.status).toBe('skipped-stale');
    expect(mockWriteQuestionnaireCells).not.toHaveBeenCalled();
    expect(mockSnapshotQuestionnaire).not.toHaveBeenCalled();
  });

  it('still applies when the snapshot fails (history is best-effort)', async () => {
    mockGetRFPDocument.mockResolvedValueOnce({ documentId: 'q-1', fileKey: 'o/p/opp/rfp-documents/q-1/live.xlsx' });
    mockSnapshotQuestionnaire.mockRejectedValueOnce(new Error('snap down'));

    const res = await applyOneEdit(questionnaireEdit(), ctx);
    expect(res.status).toBe('applied');
    expect(mockWriteQuestionnaireCells).toHaveBeenCalledTimes(1);
  });
});

describe('applyEdits (batch)', () => {
  it('is non-atomic: one failed target does not abort the rest', async () => {
    // First edit (doc) applies; second edit (form) is stale.
    mockGetRFPDocument.mockResolvedValueOnce({ htmlContentKey: 'k', title: 'Tech', content: {} });
    mockLoadHtml.mockResolvedValueOnce('<p>total cost is $2.0M</p>');
    mockGetRequiredForm.mockResolvedValueOnce({ fields: [{ fieldId: 'fld-1', value: 'different' }] });

    const results = await applyEdits({
      edits: [docEdit(), formEdit()],
      ...ctx,
    });
    expect(results).toHaveLength(2);
    expect(results[0].status).toBe('applied');
    expect(results[1].status).toBe('skipped-stale');
  });
});
