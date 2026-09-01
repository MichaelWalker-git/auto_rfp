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

import {
  extractNamePhrases,
  containsIdentifierValue,
  computeConsistencyFindings,
  computeProfileFactFindings,
} from './compliance-review-consistency';
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
    // orgId threads through to the name-grouping Bedrock call as the 3rd arg.
    expect(mockInvokeModel).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'o');
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

describe('computeProfileFactFindings (C1 identity fields)', () => {
  it('returns [] when there is no profile', async () => {
    mockGetProfile.mockResolvedValueOnce(null);
    const findings = await computeProfileFactFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'A' }]),
    });
    expect(findings).toEqual([]);
  });

  it('flags an exact field (NAICS) when a competing 6-digit code is present', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, primaryNaics: '541512' });
    mockLoadHtml.mockResolvedValue('<p>Our primary NAICS is 541511 for this effort.</p>');

    const findings = await computeProfileFactFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    const naics = findings.find((f) => f.title?.includes('NAICS'));
    expect(naics).toBeTruthy();
    expect(naics?.issueType).toBe('FACTUAL_INACCURACY');
    expect(naics?.severity).toBe('major');
    // The finding surfaces the competing code, not just the canonical one.
    expect(naics?.description).toContain('541511');
    expect(naics?.description).toContain('541512');
    // Exact-field findings do not need a Stage-2 model call.
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('does NOT flag NAICS when the label appears with no competing code (cover-page boilerplate)', async () => {
    // Regression: the exact path used to fire on the word "NAICS" alone, so a
    // cover page mentioning NAICS without the org's code got a spurious major.
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, primaryNaics: '541512' });
    mockLoadHtml.mockResolvedValue('<p>NAICS codes are listed in the attached forms.</p>');
    const findings = await computeProfileFactFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    expect(findings.find((f) => f.title?.includes('NAICS'))).toBeUndefined();
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('does NOT flag NAICS when the only 6-digit run is an unrelated number far from the label', async () => {
    // Regression (MT-1): the exact path scanned the WHOLE doc for any 6-digit
    // run, so "NAICS" anywhere + an unrelated 6-digit token anywhere (a
    // comma-less dollar amount, control number, or yearmonth) emitted a spurious
    // major. The competing code must now sit NEAR a label occurrence.
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, primaryNaics: '541512' });
    mockLoadHtml.mockResolvedValue(
      '<p>NAICS codes are provided by the CO. ' +
        'The total ceiling for this base year is $500000 across all deliverables, ' +
        'tracked under control number DOC-100234 and revised as of 202412.</p>',
    );
    const findings = await computeProfileFactFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    expect(findings.find((f) => f.title?.includes('NAICS'))).toBeUndefined();
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('does NOT flag a NAICS form field whose value is not a 6-digit code', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, primaryNaics: '541512' });
    const inventory: PackageInventory = {
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'SF-1449',
          targetKind: 'PDF_FORM',
          fields: [{ fieldId: 'f-naics', label: 'NAICS Code', value: 'See attachment' }],
        },
      ],
    };
    const findings = await computeProfileFactFindings({ orgId: 'o', modelId: 'm', inventory });
    expect(findings.find((f) => f.title?.includes('NAICS'))).toBeUndefined();
  });

  it('does NOT flag an exact field when the canonical value is present', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, primaryNaics: '541512' });
    mockLoadHtml.mockResolvedValue('<p>Our primary NAICS is 541512.</p>');
    const findings = await computeProfileFactFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    expect(findings.find((f) => f.title?.includes('NAICS'))).toBeUndefined();
  });

  it('flags a prose field (address) only when the Stage-2 model confirms a mismatch', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, address: '123 Main St' });
    mockLoadHtml.mockResolvedValue('<p>Company address: 999 Elsewhere Ave, Suite 5.</p>');
    // Model confirms the passage states a contradicting address.
    mockInvokeModel.mockResolvedValueOnce(
      modelReply({ mismatches: [{ index: 0, found: '999 Elsewhere Ave' }] }),
    );

    const findings = await computeProfileFactFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    const addr = findings.find((f) => f.title?.includes('Address'));
    expect(addr).toBeTruthy();
    expect(addr?.description).toContain('123 Main St');
    expect(addr?.description).toContain('999 Elsewhere Ave');
  });

  it('does NOT flag a prose candidate the Stage-2 model rejects', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, address: '123 Main St' });
    mockLoadHtml.mockResolvedValue('<p>The mailing address label appears but states nothing contradictory.</p>');
    mockInvokeModel.mockResolvedValueOnce(modelReply({ mismatches: [] }));

    const findings = await computeProfileFactFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    expect(findings.find((f) => f.title?.includes('Address'))).toBeUndefined();
  });

  it('does NOT flag the bare word "zip" (boilerplate) — ZIP is now model-verified, not exact', async () => {
    // Regression: ZIP used to be an EXACT fact, so "zip file" in boilerplate with
    // no canonical ZIP present emitted a major finding with no Stage-2 gate. Now
    // it's a prose candidate the model can reject.
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, zip: '20500' });
    mockLoadHtml.mockResolvedValue('<p>Deliverables will be provided as a zip file per the instructions.</p>');
    mockInvokeModel.mockResolvedValueOnce(modelReply({ mismatches: [] })); // model: not a ZIP statement

    const findings = await computeProfileFactFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    expect(findings.find((f) => f.title?.includes('ZIP'))).toBeUndefined();
  });

  it('does NOT seed an entityType candidate from a substring-only label collision ("inc" in "province"/"since")', async () => {
    // Regression: prose label matching used a bare indexOf, so the short token
    // "inc" (an entityType label) matched inside "province"/"since" and generated
    // a spurious Stage-2 candidate — cost/precision drag that can crowd the cap.
    // Whole-word matching means these unrelated words no longer seed a candidate.
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, entityType: 'LLC' });
    mockLoadHtml.mockResolvedValue(
      '<p>We have operated across the province since 2019, expanding our reach statewide.</p>',
    );
    const findings = await computeProfileFactFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    // No label present as a whole word → no candidate → no Stage-2 model call.
    expect(mockInvokeModel).not.toHaveBeenCalled();
    expect(findings.find((f) => f.title?.includes('Entity type'))).toBeUndefined();
  });

  it('flags a ZIP contradiction only when the Stage-2 model confirms it', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, zip: '20500' });
    mockLoadHtml.mockResolvedValue('<p>Remit to our office, ZIP 90210, for correspondence.</p>');
    mockInvokeModel.mockResolvedValueOnce(modelReply({ mismatches: [{ index: 0, found: '90210' }] }));

    const findings = await computeProfileFactFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    const zip = findings.find((f) => f.title?.includes('ZIP'));
    expect(zip).toBeTruthy();
    expect(zip?.description).toContain('20500');
    expect(zip?.description).toContain('90210');
  });

  it('surfaces a wrong State even though the canonical code collides with an English word', async () => {
    // Regression: canonical state "IN" matched the ordinary word "in" under the
    // case-insensitive containsCanonical, so the fact read as present everywhere,
    // the prose candidate was never generated, and a genuinely wrong state was
    // silently never flagged. Abbreviation-shaped values now match case-sensitive
    // whole-word only, so "in"/"training" no longer count as the canonical value.
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, state: 'IN' });
    mockLoadHtml.mockResolvedValue(
      '<p>The team will be trained in advance and located in our State office in Ohio, OH.</p>',
    );
    mockInvokeModel.mockResolvedValueOnce(modelReply({ mismatches: [{ index: 0, found: 'OH' }] }));

    const findings = await computeProfileFactFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    // A prose candidate was generated (the model was consulted) and the finding surfaced.
    expect(mockInvokeModel).toHaveBeenCalled();
    // orgId threads through to the Bedrock fact-verify call as the 3rd arg.
    expect(mockInvokeModel).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'o');
    const state = findings.find((f) => f.title?.includes('State'));
    expect(state).toBeTruthy();
    expect(state?.description).toContain('IN');
  });

  it('does NOT generate a State candidate when the canonical code is genuinely present (whole word)', async () => {
    // The correct state IS in the doc as a whole-word uppercase code → consistent,
    // no candidate, no model call.
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, state: 'IN' });
    mockLoadHtml.mockResolvedValue('<p>Our headquarters is registered in Indianapolis, IN 46204.</p>');

    const findings = await computeProfileFactFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    expect(mockInvokeModel).not.toHaveBeenCalled();
    expect(findings.find((f) => f.title?.includes('State'))).toBeUndefined();
  });

  it('anchors a form-field prose mismatch to the field', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, entityType: 'LLC' });
    mockInvokeModel.mockResolvedValueOnce(
      modelReply({ mismatches: [{ index: 0, found: 'Corporation' }] }),
    );
    const inventory: PackageInventory = {
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'SF-1449',
          targetKind: 'PDF_FORM',
          fields: [{ fieldId: 'f-type', label: 'Entity Type', value: 'Corporation' }],
        },
      ],
    };
    const findings = await computeProfileFactFindings({ orgId: 'o', modelId: 'm', inventory });
    const entity = findings.find((f) => f.title?.includes('Entity type'));
    expect(entity).toBeTruthy();
    expect(entity?.anchor).toEqual({ kind: 'field', fieldId: 'f-type' });
  });

  it('does not re-flag name/UEI/CAGE/EIN (those fact types are not scanned here)', async () => {
    mockGetProfile.mockResolvedValueOnce({
      companyName: CANON,
      uei: 'ABC123DEF456',
      cage: '1ABC5',
      ein: '12-3456789',
      primaryNaics: '541512',
    });
    mockLoadHtml.mockResolvedValue('<p>UEI XYZ, CAGE 9ZZZ9, EIN 99-9999999, NAICS 541512.</p>');
    const findings = await computeProfileFactFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    // No identity-identifier findings from the C1 pass — those belong to the
    // existing consistency pass (FR-3). NAICS matches so nothing at all here.
    expect(findings.find((f) => f.title?.includes('UEI'))).toBeUndefined();
    expect(findings.find((f) => f.title?.includes('CAGE'))).toBeUndefined();
    expect(findings.find((f) => f.title?.includes('EIN'))).toBeUndefined();
  });

  it('is best-effort: a Stage-2 model failure keeps exact findings, drops prose, does not throw', async () => {
    mockGetProfile.mockResolvedValueOnce({ companyName: CANON, primaryNaics: '541512', address: '123 Main St' });
    mockLoadHtml.mockResolvedValue('<p>NAICS 541511. Company address: 999 Elsewhere Ave.</p>');
    mockInvokeModel.mockRejectedValueOnce(new Error('bedrock down'));

    const findings = await computeProfileFactFindings({
      orgId: 'o', modelId: 'm', inventory: inv([{ documentId: 'd1', title: 'Cover' }]),
    });
    // Exact NAICS mismatch survives; the prose address candidate is dropped.
    expect(findings.find((f) => f.title?.includes('NAICS'))).toBeTruthy();
    expect(findings.find((f) => f.title?.includes('Address'))).toBeUndefined();
  });
});
