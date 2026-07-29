/**
 * Regression tests for chunkText.
 *
 * Primary regression: a whitespace-heavy window (e.g. wide, sparse multi-sheet
 * XLSX rendered as tab-separated text) could trim down to a length between
 * `minChars` and `overlap`, driving the loop's `start` index negative and
 * re-processing the same region forever. That grew the output array without
 * bound until the Lambda hit Runtime.OutOfMemory. `chunkText` must always make
 * forward progress and terminate.
 */

// Mock the module's top-level AWS/env dependencies so we can import the pure
// `chunkText` export without the handler's side effects.
process.env.DOCUMENTS_BUCKET = 'test-bucket';
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: (fn: unknown) => fn,
}));

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn(() => ({ send: jest.fn() })),
  PutObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  UpdateCommand: jest.fn(),
}));

jest.mock('@/helpers/db', () => ({
  docClient: { send: jest.fn() },
}));

jest.mock('@/helpers/s3', () => ({
  loadTextFromS3: jest.fn(),
}));

import { chunkText } from './chunk-document';

const OPTS = { maxChars: 2500, overlapChars: 250, minChars: 200 };

describe('chunkText', () => {
  it('returns an empty array for empty input', () => {
    expect(chunkText('', OPTS)).toEqual([]);
  });

  it('returns a single chunk for short input', () => {
    const chunks = chunkText('a'.repeat(500), OPTS);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe('a'.repeat(500));
  });

  it('terminates and stays bounded on whitespace-heavy windows (OOM regression)', () => {
    // Small values separated by long tab runs — exactly the shape a wide, sparse
    // multi-sheet XLSX produces. Each ~2500-char window trims to a short core,
    // which previously drove `start` negative and looped forever.
    const line = 'val' + '\t'.repeat(300);
    const text = line.repeat(2000); // ~600 KB, mostly whitespace

    const chunks = chunkText(text, OPTS);

    // The real assertion is that we get here at all (no infinite loop / OOM).
    expect(Array.isArray(chunks)).toBe(true);
    // A ~600 KB input at ~2250 effective chars/step must not explode into a
    // pathological number of chunks.
    expect(chunks.length).toBeLessThan(text.length / 100);
  });

  it('always makes forward progress when a trimmed chunk is shorter than the overlap', () => {
    // maxChars small enough that windows land inside the minChars..overlap danger zone.
    const opts = { maxChars: 400, overlapChars: 200, minChars: 100 };
    const text = ('x'.repeat(120) + ' '.repeat(500)).repeat(50);

    const chunks = chunkText(text, opts);

    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks.length).toBeLessThan(text.length); // terminated normally
  });

  it('covers the full input across chunks with overlap', () => {
    const text = 'The quick brown fox. '.repeat(500); // ~10.5 KB
    const chunks = chunkText(text, OPTS);

    expect(chunks.length).toBeGreaterThan(1);
    // First chunk starts at the beginning, last chunk reaches the end.
    expect(text.startsWith(chunks[0]!.slice(0, 20))).toBe(true);
    expect(text.trimEnd().endsWith(chunks[chunks.length - 1]!.slice(-20))).toBe(true);
  });

  it('drops chunks below minChars', () => {
    const chunks = chunkText('short', { maxChars: 2500, overlapChars: 250, minChars: 200 });
    expect(chunks).toEqual([]);
  });
});
