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
