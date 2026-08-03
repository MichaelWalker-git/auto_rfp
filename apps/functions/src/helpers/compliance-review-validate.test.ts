const mockLoadHtml = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  loadRFPDocumentHtml: (...a: unknown[]) => mockLoadHtml(...a),
}));

import { validateAndTagFindings, type RawFinding } from './compliance-review-validate';
import type { PackageInventory } from './compliance-review-tools';

const inventory: PackageInventory = {
  documents: [
    {
      documentId: 'doc-1',
      title: 'Technical Volume',
      targetKind: 'RFP_DOCUMENT',
      headings: ['Section L'],
      htmlContentKey: 'key-1',
    },
  ],
  forms: [
    { formId: 'form-1', name: 'SF-1449', targetKind: 'PDF_FORM', fields: [{ fieldId: 'field-9', label: 'Phone', value: null }] },
  ],
};

const inventoryWithQuestionnaire: PackageInventory = {
  documents: [
    {
      documentId: 'q-1',
      title: 'Vendor Questionnaire',
      targetKind: 'XLSX_QUESTIONNAIRE',
      headings: [],
      questionnaireCells: {
        sheetName: 'Sheet1',
        totalRows: 3,
        totalCols: 2,
        truncated: false,
        cells: [
          { row: 1, col: 1, ref: 'B2', value: 'Acme Corp' },
          { row: 2, col: 1, ref: 'B3', value: 'yes' },
        ],
      },
    },
  ],
  forms: [],
};

const raw = (over: Partial<RawFinding> = {}): RawFinding => ({
  findingId: 'x',
  targetKind: 'RFP_DOCUMENT',
  documentId: 'doc-1',
  issueType: 'MISSING_REQUIREMENT',
  severity: 'major',
  title: 't',
  description: 'd',
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadHtml.mockResolvedValue('<h2>Section L</h2><p>the offeror shall provide staffing</p>');
});

describe('validateAndTagFindings', () => {
  it('marks a heading anchor + verified snippet as valid', async () => {
    const [f] = await validateAndTagFindings(
      [raw({ anchor: { kind: 'heading', text: 'Section L' }, snippet: 'the offeror shall provide' })],
      inventory,
    );
    expect(f.anchorValid).toBe(true);
    expect(f.fingerprint).toBeTruthy();
  });

  it('marks a heading anchor invalid when the heading does not exist', async () => {
    const [f] = await validateAndTagFindings(
      [raw({ anchor: { kind: 'heading', text: 'Section Z' }, snippet: 'the offeror shall provide' })],
      inventory,
    );
    expect(f.anchorValid).toBe(false);
  });

  it('marks a heading anchor invalid when the snippet is not a real substring', async () => {
    const [f] = await validateAndTagFindings(
      [raw({ anchor: { kind: 'heading', text: 'Section L' }, snippet: 'totally fabricated text' })],
      inventory,
    );
    expect(f.anchorValid).toBe(false);
  });

  it('validates a field anchor against the form inventory (no snippet needed)', async () => {
    const [f] = await validateAndTagFindings(
      [raw({ targetKind: 'PDF_FORM', documentId: 'form-1', anchor: { kind: 'field', fieldId: 'field-9' } })],
      inventory,
    );
    expect(f.anchorValid).toBe(true);
  });

  it('marks an unknown field anchor invalid', async () => {
    const [f] = await validateAndTagFindings(
      [raw({ targetKind: 'PDF_FORM', documentId: 'form-1', anchor: { kind: 'field', fieldId: 'nope' } })],
      inventory,
    );
    expect(f.anchorValid).toBe(false);
  });

  it('validates a cell anchor against the questionnaire inventory (no snippet needed)', async () => {
    const [f] = await validateAndTagFindings(
      [
        raw({
          targetKind: 'XLSX_QUESTIONNAIRE',
          documentId: 'q-1',
          anchor: { kind: 'cell', sheet: 'Sheet1', row: 1, col: 1 },
        }),
      ],
      inventoryWithQuestionnaire,
    );
    expect(f.anchorValid).toBe(true);
  });

  it('marks a cell anchor invalid when the coords are not a filled cell', async () => {
    const [f] = await validateAndTagFindings(
      [
        raw({
          targetKind: 'XLSX_QUESTIONNAIRE',
          documentId: 'q-1',
          anchor: { kind: 'cell', sheet: 'Sheet1', row: 9, col: 9 },
        }),
      ],
      inventoryWithQuestionnaire,
    );
    expect(f.anchorValid).toBe(false);
  });

  it('marks a cell anchor invalid when the sheet name does not match', async () => {
    const [f] = await validateAndTagFindings(
      [
        raw({
          targetKind: 'XLSX_QUESTIONNAIRE',
          documentId: 'q-1',
          anchor: { kind: 'cell', sheet: 'Other Sheet', row: 1, col: 1 },
        }),
      ],
      inventoryWithQuestionnaire,
    );
    expect(f.anchorValid).toBe(false);
  });

  it('matches a cell anchor sheet name case-insensitively', async () => {
    const [f] = await validateAndTagFindings(
      [
        raw({
          targetKind: 'XLSX_QUESTIONNAIRE',
          documentId: 'q-1',
          anchor: { kind: 'cell', sheet: 'SHEET1', row: 2, col: 1 },
        }),
      ],
      inventoryWithQuestionnaire,
    );
    expect(f.anchorValid).toBe(true);
  });

  it('dedups findings that collapse to the same fingerprint', async () => {
    const dup = raw({ anchor: { kind: 'heading', text: 'Section L' }, snippet: 'the offeror shall provide' });
    const results = await validateAndTagFindings([dup, { ...dup, findingId: 'other' }], inventory);
    expect(results).toHaveLength(1);
  });

  it('keeps distinct findings', async () => {
    const a = raw({ issueType: 'MISSING_REQUIREMENT', snippet: 'the offeror shall provide' });
    const b = raw({ issueType: 'POOR_ANSWER', snippet: 'the offeror shall provide' });
    const results = await validateAndTagFindings([a, b], inventory);
    expect(results).toHaveLength(2);
  });

  it('recovers a missing documentId from a field anchor (form ownership)', async () => {
    // The model pinned the exact fieldId but omitted the formId → the finding
    // would have no "Go to spot" link. Recovery back-fills it from the anchor.
    const [f] = await validateAndTagFindings(
      [raw({ targetKind: 'PDF_FORM', documentId: undefined, anchor: { kind: 'field', fieldId: 'field-9' } })],
      inventory,
    );
    expect(f.documentId).toBe('form-1');
    expect(f.documentTitle).toBe('SF-1449');
    expect(f.anchorValid).toBe(true);
  });

  it('recovers a missing documentId from a uniquely-owned heading anchor', async () => {
    const [f] = await validateAndTagFindings(
      [raw({ documentId: undefined, anchor: { kind: 'heading', text: 'Section L' }, snippet: 'the offeror shall provide' })],
      inventory,
    );
    expect(f.documentId).toBe('doc-1');
    expect(f.anchorValid).toBe(true);
  });

  it('recovers a missing documentId by matching an exact documentTitle', async () => {
    const [f] = await validateAndTagFindings(
      [raw({ documentId: undefined, documentTitle: 'Technical Volume' })],
      inventory,
    );
    expect(f.documentId).toBe('doc-1');
  });

  it('leaves documentId undefined when there is no anchor or title to recover from', async () => {
    const [f] = await validateAndTagFindings(
      [raw({ documentId: undefined, documentTitle: undefined, title: 'General observation' })],
      inventory,
    );
    expect(f.documentId).toBeUndefined();
  });

  it('keeps two distinct anchorless MISSING_FORM findings (regression: F-001 vs F-002)', async () => {
    const offerForm = raw({
      targetKind: 'FORM_MISSING',
      documentId: undefined,
      issueType: 'MISSING_FORM',
      title: 'No standard offer/solicitation form submitted',
    });
    const repsAndCerts = raw({
      targetKind: 'FORM_MISSING',
      documentId: undefined,
      issueType: 'MISSING_FORM',
      title: 'No Representations and Certifications form submitted',
    });
    const results = await validateAndTagFindings([offerForm, repsAndCerts], inventory);
    expect(results).toHaveLength(2);
    expect(new Set(results.map((f) => f.fingerprint)).size).toBe(2);
  });
});
