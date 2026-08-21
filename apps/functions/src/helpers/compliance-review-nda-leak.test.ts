const mockListWithheld = jest.fn();
jest.mock('@/helpers/compliance-truth-sources', () => ({
  listWithheldClientNames: (...a: unknown[]) => mockListWithheld(...a),
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

import { findNameMatches, computeNdaLeakFindings } from './compliance-review-nda-leak';
import type { PackageInventory } from '@/helpers/compliance-review-tools';

const modelReply = (obj: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }] }));

beforeEach(() => {
  jest.clearAllMocks();
});

describe('findNameMatches — word-bounded, case-insensitive', () => {
  it('matches the whole word regardless of case', () => {
    expect(findNameMatches('We supported Acme Corp last year.', 'Acme Corp')).toHaveLength(1);
    expect(findNameMatches('worked with acme corp before', 'Acme Corp')).toHaveLength(1);
  });

  it('does NOT match a substring inside a larger word', () => {
    // "Delta" must not match inside "Deltatech".
    expect(findNameMatches('Deltatech is unrelated.', 'Delta')).toHaveLength(0);
  });

  it('skips names shorter than 3 chars', () => {
    expect(findNameMatches('IB is here', 'IB')).toHaveLength(0);
  });

  it('finds multiple occurrences', () => {
    expect(findNameMatches('Acme here. Acme there. Acme everywhere.', 'Acme')).toHaveLength(3);
  });
});

const htmlDocInventory = (): PackageInventory => ({
  documents: [
    {
      documentId: 'doc-1',
      title: 'Past Performance Volume',
      targetKind: 'RFP_DOCUMENT',
      headings: ['Relevant Experience'],
      htmlContentKey: 'key-doc-1',
    },
  ],
  forms: [],
});

describe('computeNdaLeakFindings', () => {
  it('returns [] when there are no withheld names', async () => {
    mockListWithheld.mockResolvedValue([]);
    expect(await computeNdaLeakFindings({ orgId: 'o', modelId: 'm', inventory: htmlDocInventory() })).toEqual([]);
    expect(mockLoadHtml).not.toHaveBeenCalled();
  });

  it('flags a non-NAMEABLE client name in an HTML doc as critical, anchored to the heading', async () => {
    mockListWithheld.mockResolvedValue([{ projectId: 'p1', name: 'Acme Corporation', kind: 'client' }]);
    mockLoadHtml.mockResolvedValue(
      '<h2>Relevant Experience</h2><p>Our team modernized systems for Acme Corporation in 2024.</p>',
    );

    const findings = await computeNdaLeakFindings({ orgId: 'o', modelId: 'm', inventory: htmlDocInventory() });
    expect(findings).toHaveLength(1);
    expect(findings[0].issueType).toBe('NDA_DISCLOSURE_LEAK');
    expect(findings[0].severity).toBe('critical');
    expect(findings[0].anchor).toEqual({ kind: 'heading', text: 'Relevant Experience' });
    // The name is only in the (already-leaked) snippet, not re-printed in the description.
    expect(findings[0].snippet.toLowerCase()).toContain('acme corporation');
    expect(findings[0].description).not.toContain('Acme Corporation');
    // Multi-word name is unambiguous → no Stage-2 model call.
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('does not duplicate one leak across nested headings (parent + child)', async () => {
    // Regression for run 7802dfb8: getSectionText let a parent heading swallow
    // its child, so a single "Ricoh" occurrence produced one finding per
    // enclosing heading level. With non-overlapping sections it is one finding.
    mockListWithheld.mockResolvedValue([{ projectId: 'p1', name: 'Ricoh', kind: 'client' }]);
    mockLoadHtml.mockResolvedValue(
      '<h2>Past Performance Volume</h2><p>overview</p>' +
        '<h3>4.2 Relevance</h3><p>This contract with Ricoh was foundational.</p>',
    );
    const inventory: PackageInventory = {
      documents: [
        {
          documentId: 'doc-1',
          title: 'Past Performance Volume',
          targetKind: 'RFP_DOCUMENT',
          headings: ['Past Performance Volume', '4.2 Relevance'],
          htmlContentKey: 'key-doc-1',
        },
      ],
      forms: [],
    };

    const findings = await computeNdaLeakFindings({ orgId: 'o', modelId: 'm', inventory });
    expect(findings).toHaveLength(1);
    expect(findings[0].anchor).toEqual({ kind: 'heading', text: '4.2 Relevance' });
  });

  it('emits one finding per distinct spot when the name recurs in different sections', async () => {
    mockListWithheld.mockResolvedValue([{ projectId: 'p1', name: 'Ricoh', kind: 'client' }]);
    mockLoadHtml.mockResolvedValue(
      '<h2>Section One</h2><p>We served Ricoh here.</p>' +
        '<h2>Section Two</h2><p>Also Ricoh appears here.</p>',
    );
    const inventory: PackageInventory = {
      documents: [
        {
          documentId: 'doc-1',
          title: 'Doc',
          targetKind: 'RFP_DOCUMENT',
          headings: ['Section One', 'Section Two'],
          htmlContentKey: 'key-doc-1',
        },
      ],
      forms: [],
    };
    const findings = await computeNdaLeakFindings({ orgId: 'o', modelId: 'm', inventory });
    expect(findings).toHaveLength(2);
    expect(new Set(findings.map((f) => (f.anchor as { text: string }).text))).toEqual(
      new Set(['Section One', 'Section Two']),
    );
  });

  it('keeps two distinct leak spots in a heading-less doc (anchor-less dedup keys on snippet)', async () => {
    // Regression: anchor-less segments all share anchor `{}`, so a dedup key of
    // docId|{}|name collapsed two genuinely different spots into one, dropping
    // the second. Distinct snippets must produce distinct candidates.
    mockListWithheld.mockResolvedValue([{ projectId: 'p1', name: 'Ricoh', kind: 'client' }]);
    // No <h2>/<h3> headings anywhere → every section is anchor-less, but the two
    // Ricoh mentions sit in separated paragraphs with different surrounding text.
    mockLoadHtml.mockResolvedValue(
      '<p>The early phase of the Ricoh modernization focused on discovery and planning.</p>' +
        '<p>Later, the Ricoh rollout expanded to three additional regional offices nationwide.</p>',
    );
    const inventory: PackageInventory = {
      documents: [
        {
          documentId: 'doc-1',
          title: 'Doc',
          targetKind: 'RFP_DOCUMENT',
          headings: [],
          htmlContentKey: 'key-doc-1',
        },
      ],
      forms: [],
    };
    const findings = await computeNdaLeakFindings({ orgId: 'o', modelId: 'm', inventory });
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.anchor === undefined)).toBe(true);
    // The two snippets are genuinely different spots.
    expect(findings[0].snippet).not.toBe(findings[1].snippet);
  });

  it('never flags a NAMEABLE client (listWithheldClientNames already excludes it)', async () => {
    // The gate lives in listWithheldClientNames; here it returns nothing.
    mockListWithheld.mockResolvedValue([]);
    mockLoadHtml.mockResolvedValue('<h2>Relevant Experience</h2><p>Public Client Inc. was great.</p>');
    expect(await computeNdaLeakFindings({ orgId: 'o', modelId: 'm', inventory: htmlDocInventory() })).toEqual([]);
  });

  it('flags a leak in a form field with a field anchor', async () => {
    mockListWithheld.mockResolvedValue([{ projectId: 'p1', name: 'Secret Client LLC', kind: 'client' }]);
    const inventory: PackageInventory = {
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'References Form',
          targetKind: 'PDF_FORM',
          fields: [{ fieldId: 'ref-1', label: 'Reference', value: 'Prior work for Secret Client LLC.' }],
        },
      ],
    };

    const findings = await computeNdaLeakFindings({ orgId: 'o', modelId: 'm', inventory });
    expect(findings).toHaveLength(1);
    expect(findings[0].anchor).toEqual({ kind: 'field', fieldId: 'ref-1' });
    expect(findings[0].targetKind).toBe('PDF_FORM');
  });

  it('builds a snippet that contains the name even when the field value has leading/internal whitespace', async () => {
    // Regression: findNameMatches ran on the RAW value but buildSnippet sliced
    // norm(value) at the RAW index — with collapsed whitespace the window shifted
    // off the match, producing a snippet that did not contain the leaked name.
    mockListWithheld.mockResolvedValue([{ projectId: 'p1', name: 'Secret Client LLC', kind: 'client' }]);
    const inventory: PackageInventory = {
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'References Form',
          targetKind: 'PDF_FORM',
          // Leading + doubled internal whitespace: norm() shortens the string, so
          // the raw match index would point past the true position post-norm.
          fields: [
            {
              fieldId: 'ref-1',
              label: 'Reference',
              value: '     Prior    engagement    delivered    for    Secret Client LLC    over    two    years.',
            },
          ],
        },
      ],
    };

    const findings = await computeNdaLeakFindings({ orgId: 'o', modelId: 'm', inventory });
    expect(findings).toHaveLength(1);
    expect(findings[0].snippet.toLowerCase()).toContain('secret client llc');
  });

  it('drops an ambiguous short name the Stage-2 model rules a coincidence', async () => {
    mockListWithheld.mockResolvedValue([{ projectId: 'p1', name: 'Delta', kind: 'client' }]);
    // Coincidental common-word use (the airline), not the confidential client.
    mockLoadHtml.mockResolvedValue('<h2>Relevant Experience</h2><p>We flew Delta to the kickoff.</p>');
    mockInvokeModel.mockResolvedValue(modelReply({ leaks: [] }));

    const findings = await computeNdaLeakFindings({ orgId: 'o', modelId: 'm', inventory: htmlDocInventory() });
    expect(mockInvokeModel).toHaveBeenCalledTimes(1);
    expect(findings).toHaveLength(0);
  });

  it('keeps an ambiguous short name the Stage-2 model confirms is the client', async () => {
    mockListWithheld.mockResolvedValue([{ projectId: 'p1', name: 'Delta', kind: 'client' }]);
    mockLoadHtml.mockResolvedValue('<h2>Relevant Experience</h2><p>We delivered the platform for Delta.</p>');
    mockInvokeModel.mockResolvedValue(modelReply({ leaks: [0] }));

    const findings = await computeNdaLeakFindings({ orgId: 'o', modelId: 'm', inventory: htmlDocInventory() });
    expect(mockInvokeModel).toHaveBeenCalledTimes(1);
    expect(findings).toHaveLength(1);
  });

  it('keeps ambiguous candidates when the Stage-2 model call fails (fail toward reporting)', async () => {
    mockListWithheld.mockResolvedValue([{ projectId: 'p1', name: 'Delta', kind: 'client' }]);
    mockLoadHtml.mockResolvedValue('<h2>Relevant Experience</h2><p>We served Delta directly.</p>');
    mockInvokeModel.mockRejectedValue(new Error('model down'));

    const findings = await computeNdaLeakFindings({ orgId: 'o', modelId: 'm', inventory: htmlDocInventory() });
    expect(findings).toHaveLength(1);
  });

  it('keeps ambiguous candidates when Stage-2 returns 200 with a missing leaks key (fail closed)', async () => {
    // Regression: a 200 whose JSON has no `leaks` array used to parse to an empty
    // set — indistinguishable from "no leaks found" — so every ambiguous candidate
    // was silently dropped. A non-verdict response must keep candidates.
    mockListWithheld.mockResolvedValue([{ projectId: 'p1', name: 'Delta', kind: 'client' }]);
    mockLoadHtml.mockResolvedValue('<h2>Relevant Experience</h2><p>We served Delta directly.</p>');
    mockInvokeModel.mockResolvedValue(modelReply({ note: 'I could not decide' })); // no `leaks` key

    const findings = await computeNdaLeakFindings({ orgId: 'o', modelId: 'm', inventory: htmlDocInventory() });
    expect(mockInvokeModel).toHaveBeenCalledTimes(1);
    expect(findings).toHaveLength(1);
  });

  it('keeps ambiguous candidates when Stage-2 returns 200 with a garbage (non-JSON-object) text block', async () => {
    mockListWithheld.mockResolvedValue([{ projectId: 'p1', name: 'Delta', kind: 'client' }]);
    mockLoadHtml.mockResolvedValue('<h2>Relevant Experience</h2><p>We served Delta directly.</p>');
    // A 200 whose text block carries no JSON object at all → safeParseJsonFromModel
    // throws → caught → candidates kept (same fail-closed guarantee as a rejection).
    mockInvokeModel.mockResolvedValue(
      new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text: 'Sorry, I am unable to help.' }] })),
    );

    const findings = await computeNdaLeakFindings({ orgId: 'o', modelId: 'm', inventory: htmlDocInventory() });
    expect(findings).toHaveLength(1);
  });

  it('keeps ambiguous candidates when Stage-2 returns 200 with no text content block (fail closed)', async () => {
    mockListWithheld.mockResolvedValue([{ projectId: 'p1', name: 'Delta', kind: 'client' }]);
    mockLoadHtml.mockResolvedValue('<h2>Relevant Experience</h2><p>We served Delta directly.</p>');
    // 200 with an empty content array → raw is null → indeterminate → keep.
    mockInvokeModel.mockResolvedValue(new TextEncoder().encode(JSON.stringify({ content: [] })));

    const findings = await computeNdaLeakFindings({ orgId: 'o', modelId: 'm', inventory: htmlDocInventory() });
    expect(findings).toHaveLength(1);
  });

  it('still prunes on an EXPLICIT empty leaks array (a genuine "no leaks" verdict)', async () => {
    // Contrast with the fail-closed cases above: an explicit { leaks: [] } is a
    // real verdict and MUST drop the coincidental match.
    mockListWithheld.mockResolvedValue([{ projectId: 'p1', name: 'Delta', kind: 'client' }]);
    mockLoadHtml.mockResolvedValue('<h2>Relevant Experience</h2><p>We flew Delta to the kickoff.</p>');
    mockInvokeModel.mockResolvedValue(modelReply({ leaks: [] }));

    const findings = await computeNdaLeakFindings({ orgId: 'o', modelId: 'm', inventory: htmlDocInventory() });
    expect(findings).toHaveLength(0);
  });

  it('never caps UNAMBIGUOUS leaks (multi-word names bypass the Stage-2 model cap)', async () => {
    // 80 distinct multi-word (unambiguous) confidential clients, each leaked once
    // in its own section — more than MAX_FACTUAL_CANDIDATES_PER_CHECK (60). The
    // cap protects the Stage-2 PROMPT (ambiguous names only); unambiguous leaks
    // must all surface (bounded to 60 individual + 1 summary for the rest).
    const N = 80;
    mockListWithheld.mockResolvedValue(
      Array.from({ length: N }, (_, i) => ({ projectId: `p${i}`, name: `Confidential Client ${i} LLC`, kind: 'client' })),
    );
    mockLoadHtml.mockResolvedValue(
      Array.from({ length: N }, (_, i) => `<h2>Section ${i}</h2><p>We served Confidential Client ${i} LLC here.</p>`).join(''),
    );
    const inventory: PackageInventory = {
      documents: [
        {
          documentId: 'doc-1',
          title: 'Doc',
          targetKind: 'RFP_DOCUMENT',
          headings: Array.from({ length: N }, (_, i) => `Section ${i}`),
          htmlContentKey: 'key-doc-1',
        },
      ],
      forms: [],
    };

    const findings = await computeNdaLeakFindings({ orgId: 'o', modelId: 'm', inventory });
    // Unambiguous names never touch the model.
    expect(mockInvokeModel).not.toHaveBeenCalled();
    // 60 individual leak findings + 1 overflow summary — no silent drop of the 20.
    const individual = findings.filter((f) => f.findingId !== 'nda-leak-overflow-summary');
    const summary = findings.find((f) => f.findingId === 'nda-leak-overflow-summary');
    expect(individual).toHaveLength(60);
    expect(summary).toBeDefined();
    expect(summary!.severity).toBe('critical');
    expect(summary!.issueType).toBe('NDA_DISCLOSURE_LEAK');
    // The summary points at no single spot and never re-prints a withheld name (FR-7).
    expect(summary!.anchor).toBeUndefined();
    expect(summary!.snippet).toBeUndefined();
    expect(summary!.title).toContain('20 more');
    expect(summary!.title).not.toContain('Confidential Client');
  });

  it('does not emit an overflow summary when everything fits under the cap', async () => {
    mockListWithheld.mockResolvedValue([{ projectId: 'p1', name: 'Acme Corporation', kind: 'client' }]);
    mockLoadHtml.mockResolvedValue(
      '<h2>Relevant Experience</h2><p>Our team modernized systems for Acme Corporation in 2024.</p>',
    );
    const findings = await computeNdaLeakFindings({ orgId: 'o', modelId: 'm', inventory: htmlDocInventory() });
    expect(findings).toHaveLength(1);
    expect(findings.some((f) => f.findingId === 'nda-leak-overflow-summary')).toBe(false);
  });

  it('fails open to [] when listWithheldClientNames throws', async () => {
    mockListWithheld.mockRejectedValue(new Error('boom'));
    expect(await computeNdaLeakFindings({ orgId: 'o', modelId: 'm', inventory: htmlDocInventory() })).toEqual([]);
  });
});
