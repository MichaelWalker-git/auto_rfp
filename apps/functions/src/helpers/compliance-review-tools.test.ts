// Mock module-load-time and I/O dependencies before importing the tools module.
jest.mock('@/helpers/env', () => ({ requireEnv: () => 'test-bucket' }));
jest.mock('@/helpers/s3', () => ({ loadTextFromS3: jest.fn() }));
jest.mock('@/helpers/pinecone', () => ({ searchSolicitation: jest.fn() }));
jest.mock('@/helpers/rfp-document', () => ({
  listRFPDocumentsByProject: jest.fn(),
  loadRFPDocumentHtml: jest.fn(),
}));
jest.mock('@/helpers/required-form', () => ({ listRequiredFormsByOpportunity: jest.fn() }));

import {
  makeComplianceToolExecutor,
  type PackageInventory,
  type FormFieldInventory,
} from './compliance-review-tools';
import {
  MAX_FORM_FIELDS_RETURNED,
  MAX_FORM_FIELD_VALUE_CHARS,
} from '@/constants/compliance-review';

const makeFields = (n: number): FormFieldInventory[] =>
  Array.from({ length: n }, (_, i) => ({
    fieldId: `f-${i}`,
    label: `Field ${i}`,
    value: i % 2 === 0 ? `value ${i}` : null,
  }));

const inventoryWith = (fields: FormFieldInventory[]): PackageInventory => ({
  documents: [],
  forms: [{ formId: 'form-1', name: 'Compliance Matrix', targetKind: 'XLSX_FORM', fields }],
});

const run = (inventory: PackageInventory, input: Record<string, unknown>) => {
  const exec = makeComplianceToolExecutor({ orgId: 'o', oppId: 'opp', inventory });
  return exec('get_form_fields', input, 'tu-1');
};

describe('get_form_fields tool', () => {
  it('returns all fields when the form is small', async () => {
    const res = await run(inventoryWith(makeFields(3)), { formId: 'form-1' });
    expect(res.content).toContain('Form "Compliance Matrix" fields (3):');
    expect(res.content).toContain('fieldId=f-0');
    expect(res.content).toContain('fieldId=f-2');
    expect(res.content).not.toContain('not shown');
  });

  it('caps a wide form at MAX_FORM_FIELDS_RETURNED and reports the omitted count', async () => {
    const total = MAX_FORM_FIELDS_RETURNED + 50;
    const res = await run(inventoryWith(makeFields(total)), { formId: 'form-1' });
    // Only the cap's worth of field lines are present.
    const shownLines = res.content.split('\n').filter((l) => l.startsWith('- fieldId=')).length;
    expect(shownLines).toBe(MAX_FORM_FIELDS_RETURNED);
    expect(res.content).toContain(`${total - MAX_FORM_FIELDS_RETURNED} more field(s) not shown`);
    // The last field beyond the cap must not leak into the prompt.
    expect(res.content).not.toContain(`fieldId=f-${total - 1}`);
  });

  it('filters by labelFilter (case-insensitive, label or value) and skips the cap when it fits', async () => {
    const fields: FormFieldInventory[] = [
      { fieldId: 'a', label: 'Contact Phone Number', value: '555-1212' },
      { fieldId: 'b', label: 'Email Address', value: 'x@y.com' },
      { fieldId: 'c', label: 'Alt line', value: 'call PHONE ext 4' },
    ];
    const res = await run(inventoryWith(fields), { formId: 'form-1', labelFilter: 'phone' });
    expect(res.content).toContain('matching "phone" (2 of 3)');
    expect(res.content).toContain('fieldId=a'); // label match
    expect(res.content).toContain('fieldId=c'); // value match
    expect(res.content).not.toContain('fieldId=b');
  });

  it('truncates long field values so one field cannot blow the prompt', async () => {
    const longVal = 'x'.repeat(MAX_FORM_FIELD_VALUE_CHARS + 500);
    const res = await run(
      inventoryWith([{ fieldId: 'big', label: 'Blob', value: longVal }]),
      { formId: 'form-1' },
    );
    // The rendered value line is bounded well under the raw length.
    expect(res.content.length).toBeLessThan(longVal.length);
  });

  it('reports no match for a filter that matches nothing', async () => {
    const res = await run(inventoryWith(makeFields(5)), { formId: 'form-1', labelFilter: 'zzz-nope' });
    expect(res.content).toContain('matching "zzz-nope" (0 of 5)');
    expect(res.content).toContain('(no matching fields)');
  });

  it('returns a clear message for an unknown formId', async () => {
    const res = await run(inventoryWith(makeFields(2)), { formId: 'ghost' });
    expect(res.content).toBe('No required form with id ghost.');
  });
});
