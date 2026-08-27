const mockLoadHtml = jest.fn();
jest.mock('@/helpers/rfp-document', () => ({
  loadRFPDocumentHtml: (...a: unknown[]) => mockLoadHtml(...a),
}));

const mockSearchPP = jest.fn();
jest.mock('@/helpers/compliance-truth-sources', () => ({
  searchPastPerformanceUsable: (...a: unknown[]) => mockSearchPP(...a),
}));

const mockInvokeModel = jest.fn();
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: (...a: unknown[]) => mockInvokeModel(...a),
}));

process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { computePastPerfValueFindings } from './compliance-review-pastperf';
import type { PackageInventory } from '@/helpers/compliance-review-tools';

const modelReply = (obj: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }] }));

const ppFact = (over: Record<string, unknown> = {}) => ({
  projectId: 'pp-1',
  title: 'Data Modernization',
  client: '[Client name withheld]',
  description: 'Modernized systems.',
  value: 5_000_000,
  contractNumber: 'W912-20-C-0001',
  score: 0.9,
  ...over,
});

const htmlInv = (): PackageInventory => ({
  documents: [
    {
      documentId: 'd1',
      title: 'Past Performance Volume',
      targetKind: 'RFP_DOCUMENT',
      headings: [],
      htmlContentKey: 'key-d1',
    },
  ],
  forms: [],
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('computePastPerfValueFindings', () => {
  it('flags a stated contract value that contradicts the matched record', async () => {
    mockLoadHtml.mockResolvedValue(
      '<p>On this contract we delivered a modernization project valued at $9,000,000.</p>',
    );
    mockSearchPP.mockResolvedValue([ppFact()]);
    mockInvokeModel.mockResolvedValue(
      modelReply({ mismatches: [{ index: 0, field: 'value', stated: '$9,000,000', actual: '$5,000,000' }] }),
    );

    const findings = await computePastPerfValueFindings({ orgId: 'o', modelId: 'm', inventory: htmlInv() });
    expect(findings).toHaveLength(1);
    expect(findings[0].issueType).toBe('FACTUAL_INACCURACY');
    expect(findings[0].severity).toBe('major');
    expect(findings[0].description).toContain('$9,000,000');
    expect(findings[0].description).toContain('$5,000,000');
  });

  it('never surfaces a client name (records are pre-redacted)', async () => {
    mockLoadHtml.mockResolvedValue('<p>Our contract delivered value of $9,000,000 for the client.</p>');
    mockSearchPP.mockResolvedValue([ppFact({ client: '[Client name withheld]' })]);
    mockInvokeModel.mockResolvedValue(
      modelReply({ mismatches: [{ index: 0, field: 'value', stated: '$9,000,000', actual: '$5,000,000' }] }),
    );

    const findings = await computePastPerfValueFindings({ orgId: 'o', modelId: 'm', inventory: htmlInv() });
    // The finding text must not contain any real client identity (only the redaction label at most).
    expect(JSON.stringify(findings)).not.toContain('Acme');
  });

  it('returns [] when no formatted-value PP references are present', async () => {
    mockLoadHtml.mockResolvedValue('<p>We are a great company with strong references.</p>');
    const findings = await computePastPerfValueFindings({ orgId: 'o', modelId: 'm', inventory: htmlInv() });
    expect(findings).toEqual([]);
    expect(mockSearchPP).not.toHaveBeenCalled();
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('does not call the model when no candidate retrieves a record', async () => {
    mockLoadHtml.mockResolvedValue('<p>This contract had a ceiling value of $2,000,000.</p>');
    mockSearchPP.mockResolvedValue([]); // nothing usable retrieved
    const findings = await computePastPerfValueFindings({ orgId: 'o', modelId: 'm', inventory: htmlInv() });
    expect(findings).toEqual([]);
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('returns [] (no findings) when the model reports no mismatch', async () => {
    mockLoadHtml.mockResolvedValue('<p>This contract had a value of $5,000,000.</p>');
    mockSearchPP.mockResolvedValue([ppFact()]);
    mockInvokeModel.mockResolvedValue(modelReply({ mismatches: [] }));
    const findings = await computePastPerfValueFindings({ orgId: 'o', modelId: 'm', inventory: htmlInv() });
    expect(findings).toEqual([]);
  });

  it('fails open to [] when the verify model call throws', async () => {
    mockLoadHtml.mockResolvedValue('<p>This contract had a value of $9,000,000.</p>');
    mockSearchPP.mockResolvedValue([ppFact()]);
    mockInvokeModel.mockRejectedValue(new Error('bedrock down'));
    const findings = await computePastPerfValueFindings({ orgId: 'o', modelId: 'm', inventory: htmlInv() });
    expect(findings).toEqual([]);
  });

  it('emits UNIQUE findingIds when the model returns the same index twice (value + contractNumber)', async () => {
    // The model can flag two fields on the SAME candidate (index 0). These are
    // distinct findings, so their findingIds must not collide (regression: the id
    // was `pastperf-<doc>-<index>`, identical for both).
    mockLoadHtml.mockResolvedValue(
      '<p>On this contract W912-99 we delivered a modernization valued at $9,000,000.</p>',
    );
    mockSearchPP.mockResolvedValue([ppFact()]);
    mockInvokeModel.mockResolvedValue(
      modelReply({
        mismatches: [
          { index: 0, field: 'value', stated: '$9,000,000', actual: '$5,000,000' },
          { index: 0, field: 'contractNumber', stated: 'W912-99', actual: 'W912-20-C-0001' },
        ],
      }),
    );

    const findings = await computePastPerfValueFindings({ orgId: 'o', modelId: 'm', inventory: htmlInv() });
    expect(findings).toHaveLength(2);
    const ids = findings.map((f) => f.findingId);
    expect(new Set(ids).size).toBe(2); // no duplicate findingId
  });

  it('anchors a form-field candidate to its field', async () => {
    mockSearchPP.mockResolvedValue([ppFact()]);
    mockInvokeModel.mockResolvedValue(
      modelReply({ mismatches: [{ index: 0, field: 'contractNumber', stated: 'X-99', actual: 'W912-20-C-0001' }] }),
    );
    const inventory: PackageInventory = {
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'References',
          targetKind: 'PDF_FORM',
          fields: [{ fieldId: 'f-ref', label: 'Contract', value: 'Prior contract number X-99-ABC delivered on time' }],
        },
      ],
    };
    const findings = await computePastPerfValueFindings({ orgId: 'o', modelId: 'm', inventory });
    expect(findings).toHaveLength(1);
    expect(findings[0].anchor).toEqual({ kind: 'field', fieldId: 'f-ref' });
  });
});
