/**
 * Tests for the package-edit proposal engine: output-schema resilience and the
 * `before`-validation that drops fabricated/mismatched proposals against the
 * real package inventory. The engine imports the Bedrock tool loop + compliance
 * tools at module load, so mock them out.
 */
const mockInvoke = jest.fn();
jest.mock('@/helpers/bedrock-tool-loop', () => ({
  invokeClaudeWithTools: (...a: unknown[]) => mockInvoke(...a),
}));

const mockBuildInventory = jest.fn();
jest.mock('@/helpers/compliance-review-tools', () => ({
  COMPLIANCE_REVIEW_TOOLS: [],
  makeComplianceToolExecutor: jest.fn(() => jest.fn()),
  buildPackageInventory: (...a: unknown[]) => mockBuildInventory(...a),
}));

const mockLoadHtml = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  loadRFPDocumentHtml: (...a: unknown[]) => mockLoadHtml(...a),
}));

// The engine re-reads FULL questionnaire cells from S3 for recall/apply. Mock it;
// default returns null so docs with a fileKey fall back to their inventory cells.
const mockReadFullCells = jest.fn().mockResolvedValue(null);
jest.mock('@/helpers/compliance-review-xlsx', () => ({
  readQuestionnaireCellInventory: (...a: unknown[]) => mockReadFullCells(...a),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { ProposeOutputSchema, runProposeEdits } from './package-edit-engine';
import { makeComplianceToolExecutor } from '@/helpers/compliance-review-tools';
import type { PackageInventory } from '@/helpers/compliance-review-tools';

const mockMakeExecutor = makeComplianceToolExecutor as unknown as jest.Mock;

const inventory: PackageInventory = {
  documents: [
    {
      documentId: 'doc-1',
      title: 'Tech Proposal',
      targetKind: 'RFP_DOCUMENT',
      headings: ['Cost'],
      htmlContentKey: 'key-1',
    },
  ],
  forms: [
    {
      formId: 'form-1',
      name: 'Pricing Form',
      targetKind: 'PDF_FORM',
      fields: [{ fieldId: 'fld-1', label: 'Total', value: '$2.0M' }],
    },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockBuildInventory.mockResolvedValue(inventory);
  mockLoadHtml.mockResolvedValue('<p>The total cost is $2.0M for the base year.</p>');
  // Default: no full re-read → docs fall back to their inventory cells.
  mockReadFullCells.mockResolvedValue(null);
});

describe('ProposeOutputSchema resilience', () => {
  it('parses replacements and defaults rationale/answer', () => {
    const parsed = ProposeOutputSchema.parse({ replacements: [{ find: 'a', replace: 'b' }] });
    expect(parsed.replacements[0]).toMatchObject({ find: 'a', replace: 'b', rationale: '' });
    expect(parsed.answer).toBe('');
  });

  it('defaults to an empty replacements array', () => {
    const parsed = ProposeOutputSchema.parse({ answer: 'nothing to do' });
    expect(parsed.replacements).toEqual([]);
  });

  it('accepts find as an array of variants', () => {
    const parsed = ProposeOutputSchema.parse({
      replacements: [{ find: ['a@x.com', 'b@x.com'], replace: 'c@x.com' }],
    });
    expect(parsed.replacements[0].find).toEqual(['a@x.com', 'b@x.com']);
  });

  it('accepts a findRegex + near replacement (no literal find)', () => {
    const parsed = ProposeOutputSchema.parse({
      replacements: [{ findRegex: '[\\w.+-]+@[\\w.-]+', near: 'Brennen', replace: 'c@x.com' }],
    });
    expect(parsed.replacements[0].findRegex).toBe('[\\w.+-]+@[\\w.-]+');
    expect(parsed.replacements[0].near).toBe('Brennen');
    expect(parsed.replacements[0].find).toEqual([]); // default
  });

  it('defaults fills to an empty array and parses a fill', () => {
    expect(ProposeOutputSchema.parse({ replacements: [] }).fills).toEqual([]);
    const parsed = ProposeOutputSchema.parse({
      fills: [{ formId: 'form-1', fieldId: 'fld-1', value: 'Brennen Stones' }],
    });
    expect(parsed.fills[0]).toMatchObject({ formId: 'form-1', fieldId: 'fld-1', value: 'Brennen Stones', rationale: '' });
  });
});

describe('runProposeEdits — find/replace expansion (backend owns recall)', () => {
  // An email that appears TWICE in the document + once in a form field — the
  // real-world "found only one occurrence" case.
  const emailInventory: PackageInventory = {
    documents: [
      {
        documentId: 'doc-1',
        title: 'Cover Letter',
        targetKind: 'RFP_DOCUMENT',
        headings: ['Header'],
        htmlContentKey: 'key-1',
      },
    ],
    forms: [
      {
        formId: 'form-1',
        name: 'POC Form',
        targetKind: 'PDF_FORM',
        fields: [{ fieldId: 'fld-1', label: 'Contact email', value: 'brennen@horustech.dev' }],
      },
    ],
  };
  const emailHtml =
    '<p>Call Reference: ACWS26 | Email: brennen@horustech.dev | AOS.</p>' +
    '<p>Point of Contact: Brennen Stones, Manager | brennen@horustech.dev</p>';

  it('threads projectId into the compliance tool executor (verify_company_facts stays project-scoped)', async () => {
    // Regression: runProposeEdits built the executor without projectId, so the
    // verify_company_facts tool ran KB search unscoped and skipped solution_plan.
    mockInvoke.mockResolvedValueOnce({ answer: 'no-op', replacements: [] });
    await runProposeEdits({ orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', instruction: 'x' });
    expect(mockMakeExecutor).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'o', oppId: 'opp', projectId: 'p' }),
    );
    // orgId also threads through to the Bedrock tool loop.
    expect(mockInvoke).toHaveBeenCalledWith(expect.objectContaining({ orgId: 'o' }));
  });

  it('expands ONE find/replace to EVERY occurrence across docs AND forms (recall fix)', async () => {
    mockBuildInventory.mockResolvedValue(emailInventory);
    mockLoadHtml.mockResolvedValue(emailHtml);
    // The model just names the value to change — no occurrence hunting.
    mockInvoke.mockResolvedValueOnce({
      answer: 'Updating email',
      replacements: [
        { find: 'brennen@horustech.dev', replace: 'new2.brennen@horus.tech', rationale: 'update email' },
      ],
    });

    const { proposals, unmatched } = await runProposeEdits({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm',
      instruction: 'change email to new2.brennen@horus.tech',
    });

    // 2 document occurrences + 1 form field = 3, from ONE replacement.
    expect(proposals).toHaveLength(3);
    expect(proposals.filter((p) => p.target.kind === 'RFP_DOCUMENT')).toHaveLength(2);
    const formEdits = proposals.filter((p) => p.target.kind === 'FORM');
    expect(formEdits).toHaveLength(1);
    for (const p of proposals) {
      expect(p.after).toContain('new2.brennen@horus.tech');
      expect(p.after).not.toContain('brennen@horustech.dev');
    }
    expect(formEdits[0].after).toBe('new2.brennen@horus.tech');
    expect(unmatched).toHaveLength(0);
  });

  it('catches TWO literal variants of the same value via a find[] array (the real bug)', async () => {
    // A doc where a prior edit changed ONE spot: header still has the original
    // email, the POC section has the interim one. Both must become the new value.
    const mixedHtml =
      '<p>Header POC: Brennen Stones | brennen@horustech.dev</p>' +
      '<p>9. Point of Contact | Email: new2.brennen@horus.tech</p>';
    mockBuildInventory.mockResolvedValue({
      documents: [
        { documentId: 'doc-1', title: 'Technical Proposal', targetKind: 'RFP_DOCUMENT', headings: ['H'], htmlContentKey: 'k' },
      ],
      forms: [],
    });
    mockLoadHtml.mockResolvedValue(mixedHtml);
    // The model lists BOTH current variants mapping to the one new value.
    mockInvoke.mockResolvedValueOnce({
      answer: 'Updating both variants of the email',
      replacements: [
        {
          find: ['brennen@horustech.dev', 'new2.brennen@horus.tech'],
          replace: 'brand.new@horus.tech',
          rationale: 'unify email',
        },
      ],
    });

    const { proposals, unmatched } = await runProposeEdits({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', instruction: 'change email everywhere',
    });

    // BOTH occurrences caught (the header + the POC section), not just one.
    expect(proposals).toHaveLength(2);
    for (const p of proposals) {
      expect(p.after).toContain('brand.new@horus.tech');
    }
    expect(unmatched).toHaveLength(0);
  });

  it('catches BOTH variants via findRegex + near WITHOUT the model enumerating them (the robust fix)', async () => {
    // Same two-variant doc, but now the model supplies ONLY a shape + anchor —
    // it does not (and need not) list the specific current emails.
    const mixedHtml =
      '<p>Header POC: Brennen Stones | brennen@horustech.dev</p>' +
      '<p>9. Point of Contact | Email: new2.brennen@horus.tech</p>';
    mockBuildInventory.mockResolvedValue({
      documents: [
        { documentId: 'doc-1', title: 'Technical Proposal', targetKind: 'RFP_DOCUMENT', headings: ['H'], htmlContentKey: 'k' },
      ],
      forms: [],
    });
    mockLoadHtml.mockResolvedValue(mixedHtml);
    mockInvoke.mockResolvedValueOnce({
      answer: "Updating Brennen's email",
      replacements: [
        { findRegex: '[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}', near: 'Brennen', replace: 'brand.new@horus.tech', rationale: 'unify email' },
      ],
    });

    const { proposals, unmatched } = await runProposeEdits({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', instruction: "change Brennen's email everywhere",
    });

    expect(proposals).toHaveLength(2);
    const matched = proposals.map((p) => p.before).sort();
    expect(matched.some((b) => b.includes('brennen@horustech.dev'))).toBe(true);
    expect(matched.some((b) => b.includes('new2.brennen@horus.tech'))).toBe(true);
    for (const p of proposals) expect(p.after).toContain('brand.new@horus.tech');
    expect(unmatched).toHaveLength(0);
  });

  it('proposes a form-field phone via findRegex + near when the anchor is in the LABEL (the phone bug)', async () => {
    mockBuildInventory.mockResolvedValue({
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'RFP Cover Sheet',
          targetKind: 'PDF_FORM',
          fields: [
            { fieldId: 'f-phone', label: "VENDOR'S PRIMARY CONTACT — Phone", value: '(480) 269-0424' },
            { fieldId: 'f-name', label: 'Company', value: 'Acme Inc.' },
          ],
        },
      ],
    });
    mockInvoke.mockResolvedValueOnce({
      answer: 'Updating phone',
      replacements: [
        { findRegex: '\\(\\d{3}\\)\\s*\\d{3}-\\d{4}', near: 'Phone', replace: '937-99-92', rationale: 'update phone' },
      ],
    });

    const { proposals, unmatched } = await runProposeEdits({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', instruction: 'change company phone to 937-99-92',
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0].target).toMatchObject({ kind: 'FORM', fieldId: 'f-phone' });
    expect(proposals[0].after).toBe('937-99-92');
    expect(unmatched).toHaveLength(0);
  });

  it('does NOT propose a literal edit for a token that appears only in a field LABEL (labels are not writable)', async () => {
    // A form field whose LABEL contains "Horus Technology" but whose VALUE is a
    // date. Forms are edited by writing field.value via updateRequiredForm — the
    // label is not a writable target — so a literal find that lives only in the
    // label must not produce a (meaningless) proposal; it is reported unmatched.
    mockBuildInventory.mockResolvedValue({
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'Cert',
          targetKind: 'PDF_FORM',
          fields: [{ fieldId: 'f-date', label: 'Horus Technology certification date', value: '2026-01-01' }],
        },
      ],
    });
    mockInvoke.mockResolvedValueOnce({
      answer: '',
      replacements: [{ find: 'Horus Technology', replace: 'Horus Tech LLC', rationale: 'rename' }],
    });

    const { proposals, unmatched } = await runProposeEdits({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', instruction: 'rename company',
    });
    expect(proposals).toHaveLength(0);
    expect(unmatched).toEqual(['Horus Technology']);
  });

  it('reports an unmatched find (value not present) instead of silently 0', async () => {
    mockBuildInventory.mockResolvedValue(emailInventory);
    mockLoadHtml.mockResolvedValue(emailHtml);
    mockInvoke.mockResolvedValueOnce({
      answer: '',
      replacements: [{ find: 'not-in-the-package@x.com', replace: 'y@z.com', rationale: 'r' }],
    });

    const { proposals, unmatched } = await runProposeEdits({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', instruction: 'x',
    });
    expect(proposals).toHaveLength(0);
    expect(unmatched).toEqual(['not-in-the-package@x.com']);
  });

  it('ignores a no-op replacement (find === replace)', async () => {
    mockBuildInventory.mockResolvedValue(emailInventory);
    mockLoadHtml.mockResolvedValue(emailHtml);
    mockInvoke.mockResolvedValueOnce({
      answer: '',
      replacements: [{ find: 'brennen@horustech.dev', replace: 'brennen@horustech.dev', rationale: 'r' }],
    });
    const { proposals, unmatched } = await runProposeEdits({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', instruction: 'x',
    });
    expect(proposals).toHaveLength(0);
    expect(unmatched).toHaveLength(0);
  });

  it('proposes QUESTIONNAIRE cell edits from questionnaireCells (literal find)', async () => {
    mockBuildInventory.mockResolvedValue({
      documents: [
        {
          documentId: 'q-1',
          title: 'Security Questionnaire',
          targetKind: 'XLSX_QUESTIONNAIRE',
          headings: [],
          questionnaireCells: {
            sheetName: 'Sheet1',
            totalRows: 2,
            totalCols: 2,
            truncated: false,
            cells: [
              { row: 0, col: 0, ref: 'A1', value: 'Company Name' },
              { row: 0, col: 1, ref: 'B1', value: 'HORUSTECH' },
            ],
          },
        },
      ],
      forms: [],
    });
    mockInvoke.mockResolvedValueOnce({
      answer: 'Fix company name',
      replacements: [{ find: 'HORUSTECH', replace: 'Horus Technology', rationale: 'canonical name' }],
    });

    const { proposals, unmatched } = await runProposeEdits({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', instruction: 'fix company name in questionnaire',
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0].target).toMatchObject({
      kind: 'QUESTIONNAIRE', documentId: 'q-1', sheetName: 'Sheet1', row: 0, col: 1, ref: 'B1',
    });
    expect(proposals[0].before).toBe('HORUSTECH');
    expect(proposals[0].after).toBe('Horus Technology');
    expect(unmatched).toHaveLength(0);
  });

  it('WR-2: scans the FULL untruncated cell value so a long cell matches (before has no [TRUNCATED])', async () => {
    // Inventory carries the TRUNCATED cell (…[TRUNCATED]); the engine must re-read
    // the full value from S3 so `before` is the real cell text (apply-matchable)
    // and a `find` past the truncation cutoff is still caught.
    const truncated = 'x'.repeat(300) + '\n\n[TRUNCATED]';
    const fullValue = 'x'.repeat(300) + ' brennen@horustech.dev tail';
    mockBuildInventory.mockResolvedValue({
      documents: [
        {
          documentId: 'q-1',
          title: 'Long Questionnaire',
          targetKind: 'XLSX_QUESTIONNAIRE',
          headings: [],
          fileKey: 'org/q-1.xlsx',
          questionnaireCells: {
            sheetName: 'Sheet1',
            totalRows: 1, totalCols: 1, truncated: true,
            cells: [{ row: 5, col: 2, ref: 'C6', value: truncated }],
          },
        },
      ],
      forms: [],
    });
    // Full re-read returns the untruncated cell.
    mockReadFullCells.mockResolvedValueOnce({
      sheetName: 'Sheet1', totalRows: 1, totalCols: 1, truncated: false,
      cells: [{ row: 5, col: 2, ref: 'C6', value: fullValue }],
    });
    mockInvoke.mockResolvedValueOnce({
      answer: 'Update email',
      replacements: [{ find: 'brennen@horustech.dev', replace: 'new@horus.tech', rationale: 'email' }],
    });

    const { proposals, unmatched } = await runProposeEdits({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', instruction: 'update email in questionnaire',
    });

    expect(mockReadFullCells).toHaveBeenCalledWith('org/q-1.xlsx', { maxCellChars: Infinity });
    expect(proposals).toHaveLength(1);
    // `before` is the FULL value (no truncation marker) → matches the apply guard.
    expect(proposals[0].before).toBe(fullValue);
    expect(proposals[0].before).not.toContain('[TRUNCATED]');
    expect(proposals[0].after).toBe('x'.repeat(300) + ' new@horus.tech tail');
    expect(unmatched).toHaveLength(0);
  });

  it('proposes a QUESTIONNAIRE cell edit via findRegex + near (anchor in the cell value)', async () => {
    mockBuildInventory.mockResolvedValue({
      documents: [
        {
          documentId: 'q-1',
          title: 'POC Questionnaire',
          targetKind: 'XLSX_QUESTIONNAIRE',
          headings: [],
          questionnaireCells: {
            sheetName: 'Sheet1',
            totalRows: 1,
            totalCols: 1,
            truncated: false,
            cells: [{ row: 3, col: 1, ref: 'B4', value: 'Brennen: brennen@horustech.dev' }],
          },
        },
      ],
      forms: [],
    });
    mockInvoke.mockResolvedValueOnce({
      answer: "Update Brennen's email",
      replacements: [
        { findRegex: '[\\w.+-]+@[\\w.-]+\\.[A-Za-z]{2,}', near: 'Brennen', replace: 'new@horus.tech', rationale: 'update email' },
      ],
    });

    const { proposals } = await runProposeEdits({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', instruction: "change Brennen's email",
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0].target).toMatchObject({ kind: 'QUESTIONNAIRE', ref: 'B4' });
    expect(proposals[0].after).toBe('Brennen: new@horus.tech');
  });

  it('fills an EMPTY form field via a fill (the "fill missing POC name" case)', async () => {
    mockBuildInventory.mockResolvedValue({
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'RFP Cover Sheet',
          targetKind: 'PDF_FORM',
          fields: [
            { fieldId: 'f-poc', label: 'Primary Contact Name', value: null },
            { fieldId: 'f-other', label: 'Title', value: 'PM' },
          ],
        },
      ],
    });
    mockInvoke.mockResolvedValueOnce({
      answer: 'Filling the missing POC name',
      replacements: [],
      fills: [{ formId: 'form-1', fieldId: 'f-poc', value: 'Brennen Stones', rationale: 'fill missing POC' }],
    });

    const { proposals, unmatched } = await runProposeEdits({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', instruction: 'fill missing POC name with Brennen Stones',
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0].target).toMatchObject({ kind: 'FORM', formId: 'form-1', fieldId: 'f-poc' });
    expect(proposals[0].before).toBe(''); // empty field → guard checks against ''
    expect(proposals[0].after).toBe('Brennen Stones');
    expect(unmatched).toHaveLength(0);
  });

  it('reports a fill naming an unknown field as unmatched', async () => {
    mockBuildInventory.mockResolvedValue({
      documents: [],
      forms: [{ formId: 'form-1', name: 'Cover', targetKind: 'PDF_FORM', fields: [{ fieldId: 'f-poc', label: 'POC', value: null }] }],
    });
    mockInvoke.mockResolvedValueOnce({
      answer: '',
      replacements: [],
      fills: [{ formId: 'form-1', fieldId: 'does-not-exist', value: 'X', rationale: '' }],
    });

    const { proposals, unmatched } = await runProposeEdits({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', instruction: 'fill it',
    });
    expect(proposals).toHaveLength(0);
    expect(unmatched[0]).toMatch(/does-not-exist/);
  });

  it('drops a no-op fill when the field already holds the target value', async () => {
    mockBuildInventory.mockResolvedValue({
      documents: [],
      forms: [{ formId: 'form-1', name: 'Cover', targetKind: 'PDF_FORM', fields: [{ fieldId: 'f-poc', label: 'POC', value: 'Brennen Stones' }] }],
    });
    mockInvoke.mockResolvedValueOnce({
      answer: '',
      replacements: [],
      fills: [{ formId: 'form-1', fieldId: 'f-poc', value: 'Brennen Stones', rationale: '' }],
    });

    const { proposals } = await runProposeEdits({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', instruction: 'set POC',
    });
    expect(proposals).toHaveLength(0);
  });

  it('MERGES two distinct replacements to the SAME form field into one combined before→after', async () => {
    // The bug: dedup keyed on formId:fieldId dropped the 2nd edit silently (hits
    // was already counted, so it never appeared in `unmatched`). Because apply is
    // an atomic whole-field overwrite, the fix composes both changes into ONE edit.
    mockBuildInventory.mockResolvedValue({
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'Contacts',
          targetKind: 'PDF_FORM',
          fields: [{ fieldId: 'f-emails', label: 'Contacts', value: 'alice@x.com; bob@x.com' }],
        },
      ],
    });
    mockInvoke.mockResolvedValueOnce({
      answer: 'Update both contact emails',
      replacements: [
        { find: 'alice@x.com', replace: 'anna@horus.tech', rationale: 'update alice' },
        { find: 'bob@x.com', replace: 'ben@horus.tech', rationale: 'update bob' },
      ],
    });

    const { proposals, unmatched } = await runProposeEdits({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', instruction: 'update both emails',
    });

    // ONE proposal for the field, carrying BOTH changes — not one dropped.
    expect(proposals).toHaveLength(1);
    expect(proposals[0].target).toMatchObject({ kind: 'FORM', fieldId: 'f-emails' });
    expect(proposals[0].before).toBe('alice@x.com; bob@x.com');
    expect(proposals[0].after).toBe('anna@horus.tech; ben@horus.tech');
    // Both rationales are preserved in the merged note.
    expect(proposals[0].rationale).toContain('update alice');
    expect(proposals[0].rationale).toContain('update bob');
    expect(unmatched).toHaveLength(0);
  });

  it('MERGES two distinct replacements to the SAME questionnaire cell into one combined edit', async () => {
    mockBuildInventory.mockResolvedValue({
      documents: [
        {
          documentId: 'q-1',
          title: 'Questionnaire',
          targetKind: 'XLSX_QUESTIONNAIRE',
          headings: [],
          questionnaireCells: {
            sheetName: 'Sheet1',
            totalRows: 1, totalCols: 1, truncated: false,
            cells: [{ row: 0, col: 0, ref: 'A1', value: 'Old Co and Old Product' }],
          },
        },
      ],
      forms: [],
    });
    mockInvoke.mockResolvedValueOnce({
      answer: 'Rebrand',
      replacements: [
        { find: 'Old Co', replace: 'New Co', rationale: 'rename company' },
        { find: 'Old Product', replace: 'New Product', rationale: 'rename product' },
      ],
    });

    const { proposals, unmatched } = await runProposeEdits({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', instruction: 'rebrand',
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0].target).toMatchObject({ kind: 'QUESTIONNAIRE', ref: 'A1' });
    expect(proposals[0].before).toBe('Old Co and Old Product');
    expect(proposals[0].after).toBe('New Co and New Product');
    expect(unmatched).toHaveLength(0);
  });

  it('a later fill to a field already targeted by a replacement wins (absolute set composes)', async () => {
    mockBuildInventory.mockResolvedValue({
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'Contacts',
          targetKind: 'PDF_FORM',
          fields: [{ fieldId: 'f-poc', label: 'POC', value: 'alice@x.com' }],
        },
      ],
    });
    mockInvoke.mockResolvedValueOnce({
      answer: 'Replace then set',
      replacements: [{ find: 'alice@x.com', replace: 'anna@horus.tech', rationale: 'update email' }],
      fills: [{ formId: 'form-1', fieldId: 'f-poc', value: 'Final Value', rationale: 'authoritative set' }],
    });

    const { proposals } = await runProposeEdits({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', instruction: 'set poc',
    });

    // Single merged edit: before is the ORIGINAL value, after is the fill's set.
    expect(proposals).toHaveLength(1);
    expect(proposals[0].target).toMatchObject({ kind: 'FORM', fieldId: 'f-poc' });
    expect(proposals[0].before).toBe('alice@x.com');
    expect(proposals[0].after).toBe('Final Value');
  });

  it('every expanded proposal has a unique editId', async () => {
    mockBuildInventory.mockResolvedValue(emailInventory);
    mockLoadHtml.mockResolvedValue(emailHtml);
    mockInvoke.mockResolvedValueOnce({
      answer: '',
      replacements: [{ find: 'brennen@horustech.dev', replace: 'new2.brennen@horus.tech', rationale: 'r' }],
    });
    const { proposals } = await runProposeEdits({
      orgId: 'o', projectId: 'p', oppId: 'opp', modelId: 'm', instruction: 'x',
    });
    const ids = proposals.map((p) => p.editId);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every(Boolean)).toBe(true);
  });
});
