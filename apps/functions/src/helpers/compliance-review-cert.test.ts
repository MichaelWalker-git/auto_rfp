const mockLoadCertRecords = jest.fn();
const mockLoadCompanyFacts = jest.fn();
jest.mock('@/helpers/compliance-truth-sources', () => ({
  loadCertRecords: (...a: unknown[]) => mockLoadCertRecords(...a),
  loadCompanyFacts: (...a: unknown[]) => mockLoadCompanyFacts(...a),
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

import { isCertExpired, computeCertFindings } from './compliance-review-cert';
import type { PackageInventory } from '@/helpers/compliance-review-tools';

const modelReply = (obj: unknown): Uint8Array =>
  new TextEncoder().encode(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(obj) }] }));

const htmlInv = (): PackageInventory => ({
  documents: [
    {
      documentId: 'd1',
      title: 'Technical Volume',
      targetKind: 'RFP_DOCUMENT',
      headings: [],
      htmlContentKey: 'key-d1',
    },
  ],
  forms: [],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadCompanyFacts.mockResolvedValue(null);
});

describe('isCertExpired — best-effort expiry parse', () => {
  const now = '2026-08-18T00:00:00.000Z';
  it('flags a past expiry', () => {
    expect(isCertExpired('2025-01-01T00:00:00.000Z', now)).toBe(true);
  });
  it('does not flag a future expiry', () => {
    expect(isCertExpired('2030-01-01T00:00:00.000Z', now)).toBe(false);
  });
  it('does not flag a null expiry', () => {
    expect(isCertExpired(null, now)).toBe(false);
  });
  it('does not flag an unparseable expiry', () => {
    expect(isCertExpired('whenever', now)).toBe(false);
  });
});

describe('computeCertFindings', () => {
  it('flags a claimed cert with no matching record as UNVERIFIED_CLAIM / minor', async () => {
    mockLoadHtml.mockResolvedValue('<p>We are ISO 27001 certified and 8(a) certified.</p>');
    mockLoadCertRecords.mockResolvedValue([]); // no records at all
    // Model maps every claim to null (no match).
    mockInvokeModel.mockResolvedValue(
      modelReply({ matches: [{ claim: 0, record: null }, { claim: 1, record: null }] }),
    );

    const findings = await computeCertFindings({ orgId: 'o', projectId: 'p', modelId: 'm', inventory: htmlInv() });
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings.every((f) => f.issueType === 'UNVERIFIED_CLAIM')).toBe(true);
    expect(findings.every((f) => f.severity === 'minor')).toBe(true);
  });

  it('flags a matched-but-EXPIRED cert as major', async () => {
    mockLoadHtml.mockResolvedValue('<p>Our ISO 27001 certification is active.</p>');
    mockLoadCertRecords.mockResolvedValue([
      { source: 'kb', label: 'ISO 27001', verified: true, expiresAt: '2024-01-01T00:00:00.000Z' },
    ]);
    mockInvokeModel.mockResolvedValue(modelReply({ matches: [{ claim: 0, record: 0 }] }));

    const findings = await computeCertFindings({ orgId: 'o', projectId: 'p', modelId: 'm', inventory: htmlInv() });
    const iso = findings.find((f) => f.title.includes('ISO 27001'));
    expect(iso).toBeTruthy();
    expect(iso?.severity).toBe('major');
  });

  it('does NOT flag a verified, unexpired matched cert', async () => {
    mockLoadHtml.mockResolvedValue('<p>Our ISO 27001 certification is active.</p>');
    mockLoadCertRecords.mockResolvedValue([
      { source: 'kb', label: 'ISO 27001', verified: true, expiresAt: '2030-01-01T00:00:00.000Z' },
    ]);
    mockInvokeModel.mockResolvedValue(modelReply({ matches: [{ claim: 0, record: 0 }] }));

    const findings = await computeCertFindings({ orgId: 'o', projectId: 'p', modelId: 'm', inventory: htmlInv() });
    expect(findings.find((f) => f.title.includes('ISO 27001'))).toBeUndefined();
  });

  it('flags a matched but UNVERIFIED (not approved) record as minor', async () => {
    mockLoadHtml.mockResolvedValue('<p>We hold CMMI Level 3.</p>');
    mockLoadCertRecords.mockResolvedValue([
      { source: 'profile', label: 'CMMI', verified: false, expiresAt: null },
    ]);
    mockInvokeModel.mockResolvedValue(modelReply({ matches: [{ claim: 0, record: 0 }] }));

    const findings = await computeCertFindings({ orgId: 'o', projectId: 'p', modelId: 'm', inventory: htmlInv() });
    const cmmi = findings.find((f) => f.title.includes('CMMI'));
    expect(cmmi).toBeTruthy();
    expect(cmmi?.severity).toBe('minor');
  });

  it('does not flag as expired when the expiry is unparseable', async () => {
    mockLoadHtml.mockResolvedValue('<p>We hold ISO 9001.</p>');
    mockLoadCertRecords.mockResolvedValue([
      { source: 'profile', label: 'ISO 9001', verified: true, expiresAt: 'sometime next year' },
    ]);
    mockInvokeModel.mockResolvedValue(modelReply({ matches: [{ claim: 0, record: 0 }] }));

    const findings = await computeCertFindings({ orgId: 'o', projectId: 'p', modelId: 'm', inventory: htmlInv() });
    // Verified + unparseable-expiry → treated as fine (not expired), no finding.
    expect(findings.find((f) => f.title.includes('ISO 9001'))).toBeUndefined();
  });

  it('returns [] when there are no cert mentions', async () => {
    mockLoadHtml.mockResolvedValue('<p>Nothing certification-related here.</p>');
    const findings = await computeCertFindings({ orgId: 'o', projectId: 'p', modelId: 'm', inventory: htmlInv() });
    expect(findings).toEqual([]);
    expect(mockInvokeModel).not.toHaveBeenCalled();
  });

  it('fails open to [] when the model call throws (treats claims as unmatched → still emits)', async () => {
    mockLoadHtml.mockResolvedValue('<p>We are 8(a) certified.</p>');
    mockLoadCertRecords.mockResolvedValue([]);
    mockInvokeModel.mockRejectedValue(new Error('bedrock down'));

    // Mapping failure is swallowed inside; claims become "no match" → minor findings.
    const findings = await computeCertFindings({ orgId: 'o', projectId: 'p', modelId: 'm', inventory: htmlInv() });
    expect(findings.every((f) => f.severity === 'minor')).toBe(true);
  });

  it('anchors a cert mention in a form field to the field', async () => {
    mockLoadCertRecords.mockResolvedValue([]);
    mockInvokeModel.mockResolvedValue(modelReply({ matches: [{ claim: 0, record: null }] }));
    const inventory: PackageInventory = {
      documents: [],
      forms: [
        {
          formId: 'form-1',
          name: 'Reps & Certs',
          targetKind: 'PDF_FORM',
          fields: [{ fieldId: 'f-sb', label: 'Set-Aside', value: 'SDVOSB' }],
        },
      ],
    };
    const findings = await computeCertFindings({ orgId: 'o', projectId: 'p', modelId: 'm', inventory });
    const sd = findings.find((f) => f.title.includes('SDVOSB'));
    expect(sd?.anchor).toEqual({ kind: 'field', fieldId: 'f-sb' });
  });
});
