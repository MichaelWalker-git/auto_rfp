const mockGetProfile = jest.fn();
jest.mock('@/helpers/company-profile', () => ({
  getCompanyProfile: (...a: unknown[]) => mockGetProfile(...a),
}));

const mockLoadHtml = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  loadRFPDocumentHtml: (...a: unknown[]) => mockLoadHtml(...a),
}));

const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: (...a: unknown[]) => mockInvokeModel(...a),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { extractNamePhrases, containsIdentifierValue, computeConsistencyFindings } from './compliance-review-consistency';
import type { PackageInventory } from '@/helpers/compliance-review-tools';

const CANON = 'Interesting Interests Inc. DBA Horus Technology';

// Encode a model response the way invokeModel returns it (bytes of the Bedrock body).
const modelReply = (obj: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }] }));

describe('containsIdentifierValue (separator-tolerant)', () => {
  it('matches an EIN regardless of the separator formatting', () => {
    // Canonical "12-3456789" must be found however the doc formats the digits.
    expect(containsIdentifierValue('EIN: 123456789', '12-3456789')).toBe(true);
    expect(containsIdentifierValue('EIN: 12-3456789', '12-3456789')).toBe(true);
    expect(containsIdentifierValue('EIN: 12 3456789', '12-3456789')).toBe(true);
    expect(containsIdentifierValue('our number is 12–3456789', '123456789')).toBe(true);
  });

  it('does not match a different identifier', () => {
    expect(containsIdentifierValue('EIN: 99-9999999', '12-3456789')).toBe(false);
  });

  it('does not match INSIDE a longer token (anchored on alnum boundaries)', () => {
    // The 9-digit EIN must not be counted "present" inside a longer digit run.
    expect(containsIdentifierValue('call 1234567890', '123456789')).toBe(false);
    expect(containsIdentifierValue('ref X123456789Z', '123456789')).toBe(false);
  });

  it('returns false for an empty / punctuation-only value', () => {
    expect(containsIdentifierValue('anything', '')).toBe(false);
    expect(containsIdentifierValue('anything', '---')).toBe(false);
  });
});

describe('extractNamePhrases', () => {
  it('pulls capitalized / ALLCAPS / CamelCase name-like phrases', () => {
    const phrases = extractNamePhrases('HORUSTECH leads. HorusTech proposes. Interesting Interests Inc. delivers. the vendor.');
    expect(phrases).toEqual(expect.arrayContaining(['HORUSTECH', 'HorusTech']));
    // lowercase filler like "the vendor" is not captured as a name
    expect(phrases).not.toContain('the vendor');
  });
});

const inv = (docs: Array<{ documentId: string; title: string }>): PackageInventory => ({
  documents: docs.map((d) => ({
    documentId: d.documentId,
    title: d.title,
    targetKind: 'RFP_DOCUMENT',
    headings: [],
    htmlContentKey: `key-${d.documentId}`,
  })),
  forms: [],
});

beforeEach(() => {
  jest.clearAllMocks();
  // mockReset (not just clearAllMocks) so any queued mock*Once value from a test
  // that returned early without consuming it can't leak into the next test.
  mockGetProfile.mockReset();
  mockLoadHtml.mockReset();
  mockInvokeModel.mockReset();
  // Default: model finds no variants.
  mockInvokeModel.mockResolvedValue(modelReply({ variants: [] }));
});

describe('computeConsistencyFindings', () => {
  it('flags the doc whose name renderings the model grouped as variants of the canonical', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, dba: CANON });
    mockLoadHtml.mockImplementation((key: string) =>
      key === 'key-d1'
        ? Promise.resolve('<p>HORUSTECH will deliver. HorusTech is ready.</p>')
        : Promise.resolve(`<p>${CANON} delivers.</p>`),
    );
    // The model groups the two d1 renderings as variants of the canonical.
    mockInvokeModel.mockResolvedValueOnce(modelReply({ variants: ['HORUSTECH', 'HorusTech'] }));

    const findings = await computeConsistencyFindings({
      orgId: 'o',
      modelId: 'm',
      inventory: inv([{ documentId: 'd1', title: 'Questionnaire' }, { documentId: 'd2', title: 'Tech Proposal' }]),
    });

    const name = findings.filter((f) => f.title?.includes('name'));
    expect(name).toHaveLength(1); // only d1 has the variants
    expect(name[0].documentId).toBe('d1');
    expect(name[0].description).toContain('HORUSTECH');
  });

  it('only trusts variant strings that were actually in the candidate list (no hallucinations)', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON });
    mockLoadHtml.mockResolvedValue('<p>HORUSTECH here.</p>');
    // Model returns a string that never appeared in the docs — must be ignored.
    mockInvokeModel.mockResolvedValueOnce(modelReply({ variants: ['Totally Made Up LLC'] }));

    const findings = await computeConsistencyFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'A' }]),
    });
    expect(findings.filter((f) => f.title?.includes('name'))).toHaveLength(0);
  });

  it('flags an identifier label present without the canonical value (deterministic)', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, uei: 'ABC123DEF456' });
    mockLoadHtml.mockResolvedValue('<p>Our UEI is XYZ999.</p>');

    const findings = await computeConsistencyFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    const uei = findings.find((f) => f.title?.includes('UEI'));
    expect(uei).toBeTruthy();
    expect(uei?.issueType).toBe('INCONSISTENCY');
    expect(uei?.severity).toBe('minor');
  });

  it('does not flag an identifier when the canonical value is present', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, uei: 'ABC123DEF456' });
    mockLoadHtml.mockResolvedValue('<p>Our UEI is ABC123DEF456.</p>');
    const findings = await computeConsistencyFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    expect(findings.find((f) => f.title?.includes('UEI'))).toBeUndefined();
  });

  it('does NOT flag EIN when the doc writes the same value with different separators', async () => {
    // Canonical EIN "12-3456789"; the doc writes it unhyphenated as "123456789".
    // Same identifier, different formatting → must NOT be reported inconsistent.
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, ein: '12-3456789' });
    mockLoadHtml.mockResolvedValue('<p>Our EIN is 123456789 on file.</p>');
    const findings = await computeConsistencyFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    expect(findings.find((f) => f.title?.includes('EIN'))).toBeUndefined();
  });

  it('does NOT flag a form identifier field that holds the same value with different formatting', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, ein: '12-3456789' });
    mockInvokeModel.mockResolvedValueOnce(modelReply({ variants: [] }));
    const inventory: PackageInventory = {
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'Reps & Certs',
          targetKind: 'PDF_FORM',
          fields: [{ fieldId: 'f-ein', label: 'EIN', value: '123456789' }],
        },
      ],
    };
    const findings = await computeConsistencyFindings({ orgId: 'o', modelId: 'm', inventory });
    expect(findings.find((f) => f.title?.includes('EIN'))).toBeUndefined();
  });

  it('does NOT false-positive on EIN when the label letters only appear inside ordinary words (H3)', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, ein: '12-3456789' });
    // "being"/"seeing"/"protein" all contain "ein" but the label EIN is never a word.
    mockLoadHtml.mockResolvedValue('<p>We are being thorough and seeing high protein value.</p>');
    const findings = await computeConsistencyFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    expect(findings.find((f) => f.title?.includes('EIN'))).toBeUndefined();
  });

  it('does NOT false-positive on CAGE when only the word "cage" (not the label) appears', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, cage: '1ABC5' });
    mockLoadHtml.mockResolvedValue('<p>The server cage is locked.</p>');
    const findings = await computeConsistencyFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    // "cage" the word is not the CAGE label used as an identifier → no finding.
    expect(findings.find((f) => f.title?.includes('CAGE'))).toBeUndefined();
  });

  it('still flags EIN as a whole word when its label is present without the value', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, ein: '12-3456789' });
    mockLoadHtml.mockResolvedValue('<p>Our EIN is 99-9999999.</p>');
    const findings = await computeConsistencyFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    expect(findings.find((f) => f.title?.includes('EIN'))).toBeTruthy();
  });

  it('treats the identifier label as case-sensitive (lowercase prose "cage" is not the CAGE label)', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, cage: '1ABC5' });
    // Uppercase CAGE label present but wrong value → flags; lowercase "cage" alone would not.
    mockLoadHtml.mockResolvedValue('<p>CAGE Code: 9ZZZ9 (the cage is on-site).</p>');
    const findings = await computeConsistencyFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    expect(findings.find((f) => f.title?.includes('CAGE'))).toBeTruthy();
  });

  it('scans a file-based XLSX questionnaire (cells, no htmlContentKey) for name variants', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, dba: CANON });
    // No HTML load for this doc — content comes from questionnaireCells.
    mockInvokeModel.mockResolvedValueOnce(modelReply({ variants: ['HORUSTECH'] }));

    const inventory: PackageInventory = {
      documents: [
        {
          documentId: 'q1',
          title: 'Security Questionnaire (XLSX)',
          targetKind: 'XLSX_QUESTIONNAIRE',
          headings: [],
          questionnaireCells: {
            sheetName: 'Sheet1',
            // A dedicated answer cell holds the company name alone (typical form shape).
            cells: [
              { row: 0, col: 0, ref: 'A1', value: 'Company Name' },
              { row: 0, col: 1, ref: 'B1', value: 'HORUSTECH' },
              { row: 1, col: 0, ref: 'A2', value: 'Compliant' },
            ],
            truncated: false,
          },
        },
      ],
      forms: [],
    };

    const findings = await computeConsistencyFindings({ orgId: 'o', modelId: 'm', inventory });
    const name = findings.filter((f) => f.title?.includes('name'));
    expect(name).toHaveLength(1);
    expect(name[0].documentId).toBe('q1');
    expect(name[0].description).toContain('HORUSTECH');
    // The finding must carry the doc's REAL kind — not a hardcoded RFP_DOCUMENT —
    // so the stats/filter UI counts it under the questionnaire and no no-op HTML
    // validation lookup is attempted.
    expect(name[0].targetKind).toBe('XLSX_QUESTIONNAIRE');
  });

  it('labels an identifier inconsistency on a questionnaire with XLSX_QUESTIONNAIRE (not RFP_DOCUMENT)', async () => {
    // Profile has a CAGE the questionnaire cells reference by LABEL but not value.
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, dba: CANON, cage: '1ABC2' });
    mockInvokeModel.mockResolvedValueOnce(modelReply({ variants: [] }));

    const inventory: PackageInventory = {
      documents: [
        {
          documentId: 'q1',
          title: 'Reps & Certs (XLSX)',
          targetKind: 'XLSX_QUESTIONNAIRE',
          headings: [],
          questionnaireCells: {
            sheetName: 'Sheet1',
            cells: [
              { row: 0, col: 0, ref: 'A1', value: 'CAGE' },
              { row: 0, col: 1, ref: 'B1', value: 'not-the-cage' },
            ],
            truncated: false,
          },
        },
      ],
      forms: [],
    };

    const findings = await computeConsistencyFindings({ orgId: 'o', modelId: 'm', inventory });
    const cage = findings.find((f) => f.title?.includes('CAGE'));
    expect(cage).toBeTruthy();
    expect(cage?.documentId).toBe('q1');
    expect(cage?.targetKind).toBe('XLSX_QUESTIONNAIRE');
  });

  it('returns [] and never throws when there are no scannable docs or forms', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON });
    const findings = await computeConsistencyFindings({ orgId: 'o', modelId: 'm', inventory: { documents: [], forms: [] } });
    expect(findings).toEqual([]);
  });

  it('flags a FORM FIELD whose value the model grouped as a name variant, anchored to the fieldId', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, dba: CANON });
    mockInvokeModel.mockResolvedValueOnce(modelReply({ variants: ['HORUSTECH'] }));

    const inventory: PackageInventory = {
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'SF-1449',
          targetKind: 'PDF_FORM',
          fields: [
            { fieldId: 'f-name', label: 'Contractor Name', value: 'HORUSTECH' },
            { fieldId: 'f-city', label: 'City', value: 'Phoenix' },
          ],
        },
      ],
    };

    const findings = await computeConsistencyFindings({ orgId: 'o', modelId: 'm', inventory });
    const name = findings.filter((f) => f.title?.includes('name'));
    expect(name).toHaveLength(1);
    expect(name[0].documentId).toBe('form-1');
    expect(name[0].targetKind).toBe('PDF_FORM');
    expect(name[0].anchor).toEqual({ kind: 'field', fieldId: 'f-name' });
    expect(name[0].description).toContain('HORUSTECH');
  });

  it('flags a form field variant even when the raw value has irregular internal whitespace', async () => {
    // The scan text is norm()'d, so the model groups the collapsed "Horus Technology".
    // The raw field value has a DOUBLE space — anchoring must normalize the value
    // too, or a genuine inconsistency is silently dropped.
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, dba: CANON });
    mockInvokeModel.mockResolvedValueOnce(modelReply({ variants: ['Horus Technology'] }));

    const inventory: PackageInventory = {
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'SF-1449',
          targetKind: 'PDF_FORM',
          fields: [{ fieldId: 'f-name', label: 'Contractor Name', value: 'Horus  Technology' }],
        },
      ],
    };

    const findings = await computeConsistencyFindings({ orgId: 'o', modelId: 'm', inventory });
    const name = findings.filter((f) => f.title?.includes('name'));
    expect(name).toHaveLength(1);
    expect(name[0].anchor).toEqual({ kind: 'field', fieldId: 'f-name' });
    expect(name[0].description).toContain('Horus Technology');
  });

  it('does not flag a form field already using the canonical name', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, dba: CANON });
    // Model returns no variants (the field uses the canonical exactly).
    mockInvokeModel.mockResolvedValueOnce(modelReply({ variants: [] }));

    const inventory: PackageInventory = {
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'SF-1449',
          targetKind: 'XLSX_FORM',
          fields: [{ fieldId: 'f-name', label: 'Contractor Name', value: CANON }],
        },
      ],
    };

    const findings = await computeConsistencyFindings({ orgId: 'o', modelId: 'm', inventory });
    expect(findings.filter((f) => f.title?.includes('name'))).toHaveLength(0);
  });

  it('flags a form field whose label names an identifier but whose value is not the canonical one', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, uei: 'ABC123DEF456' });
    mockInvokeModel.mockResolvedValueOnce(modelReply({ variants: [] }));

    const inventory: PackageInventory = {
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'Reps & Certs',
          targetKind: 'PDF_FORM',
          fields: [{ fieldId: 'f-uei', label: 'UEI Number', value: 'WRONG999' }],
        },
      ],
    };

    const findings = await computeConsistencyFindings({ orgId: 'o', modelId: 'm', inventory });
    const uei = findings.find((f) => f.title?.includes('UEI'));
    expect(uei).toBeTruthy();
    expect(uei?.documentId).toBe('form-1');
    expect(uei?.anchor).toEqual({ kind: 'field', fieldId: 'f-uei' });
    expect(uei?.severity).toBe('minor');
  });

  it('does not flag a form identifier field that already holds the canonical value', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, uei: 'ABC123DEF456' });
    mockInvokeModel.mockResolvedValueOnce(modelReply({ variants: [] }));

    const inventory: PackageInventory = {
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'Reps & Certs',
          targetKind: 'PDF_FORM',
          fields: [{ fieldId: 'f-uei', label: 'UEI Number', value: 'ABC123DEF456' }],
        },
      ],
    };

    const findings = await computeConsistencyFindings({ orgId: 'o', modelId: 'm', inventory });
    expect(findings.find((f) => f.title?.includes('UEI'))).toBeUndefined();
  });

  it('is best-effort: a model-call failure yields no name findings, does not throw', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON });
    mockLoadHtml.mockResolvedValue('<p>HORUSTECH here.</p>');
    mockInvokeModel.mockRejectedValueOnce(new Error('bedrock down'));
    const findings = await computeConsistencyFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'A' }]),
    });
    expect(findings.filter((f) => f.title?.includes('name'))).toHaveLength(0);
  });
});
