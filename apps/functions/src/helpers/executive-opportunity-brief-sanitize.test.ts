import { sanitizeSummaryResponse, scanDeliveryLocationConstraint, scanPhysicalSubmission } from './executive-opportunity-brief';
import { QuickSummarySchema } from '@auto-rfp/core';

// Mock environment variables required by the module
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';
process.env.DOCUMENTS_BUCKET = 'test-bucket';

// Mock AWS SDK and other dependencies before importing
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn(() => ({})),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({ send: jest.fn() })),
  },
  PutCommand: jest.fn(),
  QueryCommand: jest.fn(),
  UpdateCommand: jest.fn(),
}));

jest.mock('./db', () => ({
  docClient: { send: jest.fn() },
  getItem: jest.fn(),
}));

jest.mock('./s3', () => ({
  loadTextFromS3: jest.fn(),
}));

jest.mock('./embeddings', () => ({
  getEmbedding: jest.fn(),
}));

jest.mock('./semantic-search', () => ({
  semanticSearchChunks: jest.fn(),
}));

jest.mock('./bedrock-http-client', () => ({
  invokeModel: jest.fn(),
}));

jest.mock('./date', () => ({
  nowIso: jest.fn(() => '2026-01-01T00:00:00.000Z'),
}));

jest.mock('./env', () => ({
  requireEnv: jest.fn((key: string, fallback?: string) => {
    const envMap: Record<string, string> = {
      DB_TABLE_NAME: 'test-table',
      DOCUMENTS_BUCKET: 'test-bucket',
    };
    return envMap[key] ?? fallback ?? `mock-${key}`;
  }),
}));

describe('scanPhysicalSubmission', () => {
  it('returns null for empty string', () => {
    expect(scanPhysicalSubmission('')).toBeNull();
  });

  it('returns null when no indicators are present', () => {
    expect(scanPhysicalSubmission('Submit your proposal to the contracting officer.')).toBeNull();
    expect(scanPhysicalSubmission('This solicitation is for cloud services.')).toBeNull();
  });

  it('detects PHYSICAL-only text', () => {
    const r = scanPhysicalSubmission('Mail proposals to the address below. Send via certified mail.');
    expect(r?.submissionMethod).toBe('PHYSICAL');
    expect(r?.submissionMailingAddress).toBeNull();
    expect(r?.submissionMethodRationale).toContain('Mail proposals');
  });

  it('detects ELECTRONIC-only text', () => {
    const r = scanPhysicalSubmission('Offerors shall submit electronically via SAM.gov. Electronic submission only.');
    expect(r?.submissionMethod).toBe('ELECTRONIC');
    expect(r?.submissionMailingAddress).toBeNull();
    expect(r?.submissionMethodRationale).toBeTruthy();
  });

  it('detects BOTH when physical and electronic indicators appear', () => {
    const text = 'Submit hard copies to the contract office. Electronic submission only accepted via portal.';
    const r = scanPhysicalSubmission(text);
    expect(r?.submissionMethod).toBe('BOTH');
  });

  it('is case-insensitive for physical indicators', () => {
    expect(scanPhysicalSubmission('SUBMIT HARD COPIES to the office.')?.submissionMethod).toBe('PHYSICAL');
    expect(scanPhysicalSubmission('HAND-DELIVER to the contracting officer.')?.submissionMethod).toBe('PHYSICAL');
    expect(scanPhysicalSubmission('OVERNIGHT DELIVERY required.')?.submissionMethod).toBe('PHYSICAL');
  });

  it('is case-insensitive for electronic indicators', () => {
    expect(scanPhysicalSubmission('SUBMIT ELECTRONICALLY via the portal.')?.submissionMethod).toBe('ELECTRONIC');
    expect(scanPhysicalSubmission('ELECTRONIC SUBMISSION ONLY.')?.submissionMethod).toBe('ELECTRONIC');
    expect(scanPhysicalSubmission('NO HARD COPIES accepted.')?.submissionMethod).toBe('ELECTRONIC');
  });

  it('handles mixed-case carrier names', () => {
    expect(scanPhysicalSubmission('Deliver via FedEx overnight.')?.submissionMethod).toBe('PHYSICAL');
    expect(scanPhysicalSubmission('Send via fedex to the address.')?.submissionMethod).toBe('PHYSICAL');
    expect(scanPhysicalSubmission('Mail via USPS certified mail.')?.submissionMethod).toBe('PHYSICAL');
  });

  it('detects "original plus N copies" pattern', () => {
    const r = scanPhysicalSubmission('Offerors must provide the original plus 3 copies to the contracting officer.');
    expect(r?.submissionMethod).toBe('PHYSICAL');
  });

  it('extracts mailing address from surrounding text when PHYSICAL detected', () => {
    const text = [
      'Submit hard copies to the address below.',
      '123 Main Street',
      'Suite 400',
      'Washington, DC 20001',
      'All proposals must arrive by the due date.',
    ].join('\n');
    const r = scanPhysicalSubmission(text);
    expect(r?.submissionMethod).toBe('PHYSICAL');
    expect(r?.submissionMailingAddress).not.toBeNull();
    expect(r?.submissionMailingAddress?.addressLine1).toContain('123 Main Street');
    expect(r?.submissionMailingAddress?.locality).toBe('Washington');
    expect(r?.submissionMailingAddress?.administrativeArea).toBe('DC');
    expect(r?.submissionMailingAddress?.postalCode).toBe('20001');
    expect(r?.submissionMailingAddress?.countryCode).toBe('US');
  });

  it('returns null submissionMailingAddress when no address found near physical indicator', () => {
    const r = scanPhysicalSubmission('Submit hard copies to the office. No address provided here.');
    expect(r?.submissionMethod).toBe('PHYSICAL');
    expect(r?.submissionMailingAddress).toBeNull();
  });

  it('does not extract address for ELECTRONIC-only detection', () => {
    const text = 'Submit electronically via SAM.gov portal. 123 Agency Road, Washington, DC 20001';
    const r = scanPhysicalSubmission(text);
    expect(r?.submissionMethod).toBe('ELECTRONIC');
    expect(r?.submissionMailingAddress).toBeNull();
  });

  it('caps submissionMethodRationale at 500 characters', () => {
    const longText = 'Mail proposals to '.padEnd(600, 'x');
    const r = scanPhysicalSubmission(longText);
    expect(r?.submissionMethodRationale).not.toBeNull();
    expect(r?.submissionMethodRationale!.length).toBeLessThanOrEqual(500);
  });
});

describe('scanDeliveryLocationConstraint', () => {
  it('detects the real SC "OFFSHORE CONTRACTING PROHIBITED" clause as US_ONLY', () => {
    const text = 'Various terms and conditions apply. [07-7B115-1] OFFSHORE CONTRACTING PROHIBITED (FEB 2015): No part of the resulting contract from this solicitation may be performed offshore of the United States by persons located offshore.';
    const r = scanDeliveryLocationConstraint(text);
    expect(r?.constraint).toBe('US_ONLY');
    expect(r?.rationale).toContain('OFFSHORE CONTRACTING PROHIBITED');
  });

  it('detects US-citizen-only language as US_ONLY', () => {
    expect(scanDeliveryLocationConstraint('All personnel must be a U.S. citizen.')?.constraint).toBe('US_ONLY');
    expect(scanDeliveryLocationConstraint('Staffing: US citizens only.')?.constraint).toBe('US_ONLY');
  });

  it('detects "work must be performed in the United States" as US_ONLY', () => {
    expect(scanDeliveryLocationConstraint('All work shall be performed in the United States.')?.constraint).toBe('US_ONLY');
  });

  it('detects explicit offshore permission as OFFSHORE_ALLOWED', () => {
    expect(scanDeliveryLocationConstraint('Offshore delivery is permitted for this engagement.')?.constraint).toBe('OFFSHORE_ALLOWED');
    expect(scanDeliveryLocationConstraint('Work may be performed remotely.')?.constraint).toBe('OFFSHORE_ALLOWED');
  });

  it('prefers US_ONLY when both restriction and permission-like language appear', () => {
    const text = 'Remote delivery is permitted. However, offshore contracting is prohibited.';
    expect(scanDeliveryLocationConstraint(text)?.constraint).toBe('US_ONLY');
  });

  it('returns null when no explicit delivery-location language is present', () => {
    expect(scanDeliveryLocationConstraint('The City seeks an EDMS with document storage and retrieval.')).toBeNull();
    expect(scanDeliveryLocationConstraint('')).toBeNull();
  });
});

describe('sanitizeSummaryResponse', () => {
  it('returns non-object values unchanged', () => {
    expect(sanitizeSummaryResponse(null)).toBeNull();
    expect(sanitizeSummaryResponse(undefined)).toBeUndefined();
    expect(sanitizeSummaryResponse('string')).toBe('string');
    expect(sanitizeSummaryResponse(42)).toBe(42);
  });

  it('converts summary object to JSON string', () => {
    const raw = {
      summary: { text: 'A summary', details: 'More info' },
      title: 'Test',
    };

    const result = sanitizeSummaryResponse(raw) as Record<string, unknown>;
    expect(typeof result.summary).toBe('string');
    expect(result.summary).toContain('A summary');
  });

  it('converts summary array to JSON string', () => {
    const raw = {
      summary: ['First sentence.', 'Second sentence.'],
    };

    const result = sanitizeSummaryResponse(raw) as Record<string, unknown>;
    expect(typeof result.summary).toBe('string');
    expect(result.summary).toContain('First sentence.');
  });

  it('leaves string summary unchanged', () => {
    const raw = {
      summary: 'A valid summary string.',
    };

    const result = sanitizeSummaryResponse(raw) as Record<string, unknown>;
    expect(result.summary).toBe('A valid summary string.');
  });

  it('converts null optional string fields to undefined (deletes them)', () => {
    const raw = {
      title: null,
      agency: null,
      office: null,
      solicitationNumber: null,
      naics: null,
      placeOfPerformance: null,
      estimatedValueUsd: null,
      periodOfPerformance: null,
      summary: 'Valid summary.',
    };

    const result = sanitizeSummaryResponse(raw) as Record<string, unknown>;
    expect(result.title).toBeUndefined();
    expect(result.agency).toBeUndefined();
    expect(result.office).toBeUndefined();
    expect(result.solicitationNumber).toBeUndefined();
    expect(result.naics).toBeUndefined();
    expect(result.placeOfPerformance).toBeUndefined();
    expect(result.estimatedValueUsd).toBeUndefined();
    expect(result.periodOfPerformance).toBeUndefined();
    expect(result.summary).toBe('Valid summary.');
  });

  it('removes metadata, _raw, and evidence fields', () => {
    const raw = {
      summary: 'Valid summary.',
      metadata: { source: 'bedrock' },
      _raw: 'raw response text',
      evidence: 'some evidence',
      title: 'Keep this',
    };

    const result = sanitizeSummaryResponse(raw) as Record<string, unknown>;
    expect(result.metadata).toBeUndefined();
    expect(result._raw).toBeUndefined();
    expect(result.evidence).toBeUndefined();
    expect(result.title).toBe('Keep this');
    expect(result.summary).toBe('Valid summary.');
  });

  it('does not modify non-null string fields', () => {
    const raw = {
      title: 'Cloud Migration',
      agency: 'DoD',
      summary: 'Valid summary.',
    };

    const result = sanitizeSummaryResponse(raw) as Record<string, unknown>;
    expect(result.title).toBe('Cloud Migration');
    expect(result.agency).toBe('DoD');
  });

  it('produces output that passes QuickSummarySchema after sanitization', () => {
    // Simulate a problematic LLM response
    const raw = {
      title: 'Cloud Services',
      agency: null,
      office: null,
      summary: { text: 'This is a summary object from LLM' },
      evidence: 'should be removed',
      metadata: { model: 'claude-3' },
      contractType: 'FIXED_PRICE',
    };

    const sanitized = sanitizeSummaryResponse(raw);
    const { success, data } = QuickSummarySchema.safeParse(sanitized);
    expect(success).toBe(true);
    expect(data?.title).toBe('Cloud Services');
    expect(typeof data?.summary).toBe('string');
    expect(data?.summary).toContain('This is a summary object from LLM');
  });

  it('handles LLM response with all null optional fields after sanitization', () => {
    const raw = {
      title: null,
      agency: null,
      office: null,
      solicitationNumber: null,
      naics: null,
      placeOfPerformance: null,
      estimatedValueUsd: null,
      periodOfPerformance: null,
      contractType: null,
      setAside: null,
      summary: 'Minimal but valid summary.',
    };

    const sanitized = sanitizeSummaryResponse(raw);
    const { success, data } = QuickSummarySchema.safeParse(sanitized);
    expect(success).toBe(true);
    expect(data?.summary).toBe('Minimal but valid summary.');
    // contractType and setAside should get defaults since they were null (not deleted by sanitizer, but Zod default handles it)
    expect(data?.contractType).toBe('UNKNOWN');
    expect(data?.setAside).toBe('UNKNOWN');
  });
});
