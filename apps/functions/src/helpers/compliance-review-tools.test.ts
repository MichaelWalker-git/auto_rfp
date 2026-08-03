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
  MAX_QUESTIONNAIRE_CELLS_RETURNED,
} from '@/constants/compliance-review';
import type { QuestionnaireCellInventory } from './compliance-review-xlsx';

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

// ─── get_questionnaire_cells ────────────────────────────────────────────────

const makeCells = (n: number): QuestionnaireCellInventory['cells'] =>
  Array.from({ length: n }, (_, i) => ({
    row: i,
    col: 1,
    ref: `B${i + 1}`,
    value: `answer ${i}`,
  }));

const questionnaireInventory = (
  cells: QuestionnaireCellInventory['cells'],
  truncated = false,
): PackageInventory => ({
  documents: [
    {
      documentId: 'q-1',
      title: 'Vendor Questionnaire',
      targetKind: 'XLSX_QUESTIONNAIRE',
      headings: [],
      questionnaireCells: { sheetName: 'Sheet1', totalRows: cells.length, totalCols: 2, truncated, cells },
    },
  ],
  forms: [],
});

const runCells = (inventory: PackageInventory, input: Record<string, unknown>) => {
  const exec = makeComplianceToolExecutor({ orgId: 'o', oppId: 'opp', inventory });
  return exec('get_questionnaire_cells', input, 'tu-1');
};

describe('get_questionnaire_cells tool', () => {
  it('returns cells with sheet name, 0-based coords, and A1 ref', async () => {
    const res = await runCells(questionnaireInventory(makeCells(3)), { documentId: 'q-1' });
    expect(res.content).toContain('Questionnaire "Vendor Questionnaire" [sheet "Sheet1"] filled cells (3):');
    expect(res.content).toContain('sheet="Sheet1" row=0 col=1 (B1)');
    expect(res.content).toContain('sheet="Sheet1" row=2 col=1 (B3)');
  });

  it('caps at MAX_QUESTIONNAIRE_CELLS_RETURNED and reports the omitted count', async () => {
    const total = MAX_QUESTIONNAIRE_CELLS_RETURNED + 25;
    const res = await runCells(questionnaireInventory(makeCells(total)), { documentId: 'q-1' });
    const shownLines = res.content.split('\n').filter((l) => l.startsWith('- sheet=')).length;
    expect(shownLines).toBe(MAX_QUESTIONNAIRE_CELLS_RETURNED);
    expect(res.content).toContain(`${total - MAX_QUESTIONNAIRE_CELLS_RETURNED} more cell(s) not shown`);
  });

  it('filters by valueFilter (case-insensitive)', async () => {
    const cells = [
      { row: 0, col: 1, ref: 'B1', value: 'Acme Corporation' },
      { row: 1, col: 1, ref: 'B2', value: 'yes' },
      { row: 2, col: 1, ref: 'B3', value: 'ACME again' },
    ];
    const res = await runCells(questionnaireInventory(cells), { documentId: 'q-1', valueFilter: 'acme' });
    expect(res.content).toContain('matching "acme" (2 of 3)');
    expect(res.content).toContain('(B1)');
    expect(res.content).toContain('(B3)');
    expect(res.content).not.toContain('(B2)');
  });

  it('surfaces a truncation notice when the questionnaire was capped at build time', async () => {
    const res = await runCells(questionnaireInventory(makeCells(2), true), { documentId: 'q-1' });
    expect(res.content).toContain('The questionnaire is large');
  });

  it('returns a clear message for an unknown documentId', async () => {
    const res = await runCells(questionnaireInventory(makeCells(1)), { documentId: 'ghost' });
    expect(res.content).toBe('No XLSX questionnaire with id ghost.');
  });

  it('reports when the questionnaire could not be read (no cell inventory)', async () => {
    const inventory: PackageInventory = {
      documents: [
        { documentId: 'q-1', title: 'Broken', targetKind: 'XLSX_QUESTIONNAIRE', headings: [] },
      ],
      forms: [],
    };
    const res = await runCells(inventory, { documentId: 'q-1' });
    expect(res.content).toContain('could not be read');
  });
});

describe('list_package_documents tool', () => {
  it('renders an XLSX questionnaire line pointing to get_questionnaire_cells', async () => {
    const exec = makeComplianceToolExecutor({
      orgId: 'o',
      oppId: 'opp',
      inventory: questionnaireInventory(makeCells(4)),
    });
    const res = await exec('list_package_documents', {}, 'tu-1');
    expect(res.content).toContain('documentId=q-1');
    expect(res.content).toContain('XLSX QUESTIONNAIRE | 4 filled cell(s) — read with get_questionnaire_cells');
  });
});
