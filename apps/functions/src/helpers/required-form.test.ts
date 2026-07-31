/**
 * Tests for the required-form persistence helper, focused on field compression.
 *
 * Regression: large multi-sheet XLSX matrices produced a `fields` array big
 * enough to push the required-form DynamoDB item past the hard 400 KB limit,
 * failing the write with "Item size to update has exceeded the maximum allowed
 * size". Fields are now gzip-compressed into a binary `fieldsGz` attribute and
 * the inline `fields` array is kept empty. Reads transparently decompress, and
 * legacy items (inline `fields`, no `fieldsGz`) still read correctly.
 */

import { gzipSync } from 'node:zlib';

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.DOCUMENTS_BUCKET = 'test-bucket';

// Capture what createItem is asked to store, and let the test control what the
// docClient returns for reads/updates.
const mockCreateItem = jest.fn();
const mockScanByPkWithFilter = jest.fn();
const mockSend = jest.fn();

jest.mock('./db', () => ({
  createItem: (...args: unknown[]) => mockCreateItem(...args),
  scanByPkWithFilter: (...args: unknown[]) => mockScanByPkWithFilter(...args),
  docClient: { send: (...args: unknown[]) => mockSend(...args) },
  // DBItem is a type-only export; nothing to mock at runtime.
}));

import {
  createRequiredForm,
  getRequiredForm,
  updateRequiredForm,
  listRequiredFormsByOpportunity,
  findRequiredFormByFormId,
} from './required-form';
import type { DetectedFormField, CreateRequiredFormDTO } from '@auto-rfp/core';

const makeField = (i: number): DetectedFormField => ({
  fieldId: `field-${i}`,
  label: `Requirement ${i} — Fully Meets`,
  value: null,
  status: 'MANUAL_REQUIRED',
  confidence: null,
  profileFieldKey: null,
  manualReason: 'Compliance determination requires manual review',
  pageNumber: null,
  cellReference: `A${i}`,
  sheetName: 'Sheet1',
  sheetIndex: 0,
  boundingBox: null,
  markType: 'TEXT',
  markChar: null,
  markGeometry: null,
  matrixCategory: 'Security',
  matrixFeature: `Requirement ${i}`,
  matrixColumn: 'FULLY_MEETS',
});

const dto: CreateRequiredFormDTO = {
  orgId: 'org-1',
  projectId: 'proj-1',
  opportunityId: 'opp-1',
  name: 'Compliance Matrix',
  formType: 'XLSX_MATRIX',
  sourceFileName: 'matrix.xlsx',
  sourceFileKey: 'org-1/matrix.xlsx',
};

describe('required-form field compression', () => {
  beforeEach(() => {
    mockCreateItem.mockReset();
    mockScanByPkWithFilter.mockReset();
    mockSend.mockReset();
    // createItem echoes back the stored item with keys attached.
    mockCreateItem.mockImplementation((_pk: string, _sk: string, item: Record<string, unknown>) => ({
      partition_key: _pk,
      sort_key: _sk,
      createdAt: 't',
      updatedAt: 't',
      ...item,
    }));
  });

  it('stores fields compressed (fieldsGz set, inline fields empty) and returns them decoded', async () => {
    const fields = Array.from({ length: 20 }, (_, i) => makeField(i));

    const { item, formId } = await createRequiredForm({ dto, fields });

    expect(formId).toBeTruthy();
    // What was handed to createItem:
    const storedItem = mockCreateItem.mock.calls[0]![2] as Record<string, unknown>;
    expect(storedItem.fields).toEqual([]); // inline stays empty
    expect(storedItem.fieldsGz).toBeInstanceOf(Uint8Array);
    // Caller sees the decoded fields, never the binary attribute.
    expect(item.fields).toHaveLength(20);
    expect(item.fields[0]!.fieldId).toBe('field-0');
    expect((item as Record<string, unknown>).fieldsGz).toBeUndefined();
  });

  it('round-trips fields through getRequiredForm', async () => {
    const fields = [makeField(1), makeField(2)];
    mockSend.mockResolvedValueOnce({
      Item: {
        partition_key: 'REQUIRED_FORM',
        sort_key: 'org-1#proj-1#opp-1#form-1',
        formId: 'form-1',
        fields: [],
        fieldsGz: new Uint8Array(gzipSync(Buffer.from(JSON.stringify(fields), 'utf-8'))),
      },
    });

    const form = await getRequiredForm({ orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1', formId: 'form-1' });

    expect(form).not.toBeNull();
    expect(form!.fields).toHaveLength(2);
    expect(form!.fields[1]!.matrixFeature).toBe('Requirement 2');
    expect((form as Record<string, unknown>).fieldsGz).toBeUndefined();
  });

  it('reads legacy items with inline fields and no fieldsGz', async () => {
    const fields = [makeField(9)];
    mockSend.mockResolvedValueOnce({
      Item: {
        partition_key: 'REQUIRED_FORM',
        sort_key: 'org-1#proj-1#opp-1#legacy',
        formId: 'legacy',
        fields, // legacy: stored inline, no fieldsGz
      },
    });

    const form = await getRequiredForm({ orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1', formId: 'legacy' });

    expect(form!.fields).toHaveLength(1);
    expect(form!.fields[0]!.fieldId).toBe('field-9');
  });

  it('returns null from getRequiredForm when the item is missing', async () => {
    mockSend.mockResolvedValueOnce({});
    const form = await getRequiredForm({ orgId: 'o', projectId: 'p', opportunityId: 'op', formId: 'nope' });
    expect(form).toBeNull();
  });

  it('compresses fields in updateRequiredForm patches (never writes inline fields)', async () => {
    const fields = Array.from({ length: 5 }, (_, i) => makeField(i));
    mockSend.mockResolvedValueOnce({
      Attributes: {
        partition_key: 'REQUIRED_FORM',
        sort_key: 'org-1#proj-1#opp-1#form-1',
        formId: 'form-1',
        fields: [],
        fieldsGz: new Uint8Array(gzipSync(Buffer.from(JSON.stringify(fields), 'utf-8'))),
      },
    });

    const updated = await updateRequiredForm({
      orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1', formId: 'form-1',
      patch: { fields, status: 'READY' },
    });

    // Inspect the UpdateCommand the helper built.
    const command = mockSend.mock.calls[0]![0] as { input: Record<string, unknown> };
    const input = command.input;
    const exprValues = input.ExpressionAttributeValues as Record<string, unknown>;
    expect(exprValues[':v_fields']).toEqual([]); // inline never populated
    expect(exprValues[':v_fieldsGz']).toBeInstanceOf(Uint8Array);
    expect(input.UpdateExpression).toContain('#f_fieldsGz = :v_fieldsGz');
    // Returned attributes are decoded.
    expect(updated.fields).toHaveLength(5);
  });

  it('throws a clear error when compressed fields still exceed the item budget', async () => {
    // High-entropy random values resist gzip, so even a few thousand fields
    // blow past the 380 KB compressed budget.
    const randStr = (n: number) => {
      let s = '';
      while (s.length < n) s += Math.random().toString(36).slice(2);
      return s.slice(0, n);
    };
    const bigFields: DetectedFormField[] = Array.from({ length: 4000 }, (_, i) => ({
      ...makeField(i),
      value: randStr(200),
      label: randStr(120),
    }));

    await expect(
      updateRequiredForm({
        orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1', formId: 'form-1',
        patch: { fields: bigFields },
      }),
    ).rejects.toThrow(/exceed the DynamoDB item budget/);
    // Never reached the DynamoDB write.
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('decodes every item from listRequiredFormsByOpportunity', async () => {
    const a = [makeField(1)];
    const b = [makeField(2), makeField(3)];
    mockSend.mockResolvedValueOnce({
      Items: [
        {
          partition_key: 'REQUIRED_FORM', sort_key: 'org-1#proj-1#opp-1#a', formId: 'a', fields: [],
          fieldsGz: new Uint8Array(gzipSync(Buffer.from(JSON.stringify(a), 'utf-8'))),
        },
        {
          partition_key: 'REQUIRED_FORM', sort_key: 'org-1#proj-1#opp-1#b', formId: 'b',
          fields: b, // legacy inline mixed in
        },
      ],
    });

    const forms = await listRequiredFormsByOpportunity({ orgId: 'org-1', projectId: 'proj-1', opportunityId: 'opp-1' });

    expect(forms).toHaveLength(2);
    expect(forms[0]!.fields).toHaveLength(1);
    expect(forms[1]!.fields).toHaveLength(2);
    expect(forms.every((f) => (f as Record<string, unknown>).fieldsGz === undefined)).toBe(true);
  });

  it('decodes findRequiredFormByFormId results', async () => {
    const fields = [makeField(42)];
    mockScanByPkWithFilter.mockResolvedValueOnce([
      {
        partition_key: 'REQUIRED_FORM', sort_key: 'org-1#proj-1#opp-1#x', formId: 'x', fields: [],
        fieldsGz: new Uint8Array(gzipSync(Buffer.from(JSON.stringify(fields), 'utf-8'))),
      },
    ]);

    const form = await findRequiredFormByFormId('x');
    expect(form!.fields[0]!.matrixFeature).toBe('Requirement 42');
  });
});
