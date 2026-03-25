import { sanitizeSummaryResponse } from './executive-opportunity-brief';
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
