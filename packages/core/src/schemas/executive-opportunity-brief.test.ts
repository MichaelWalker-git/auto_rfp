import { describe, it, expect } from 'vitest';
import { QuickSummarySchema } from './executive-opportunity-brief';

describe('QuickSummarySchema', () => {
  // ── Happy path ──

  it('parses a fully populated summary', () => {
    const input = {
      title: 'Cloud Migration Services',
      agency: 'Department of Defense',
      office: 'Office of IT',
      solicitationNumber: 'FA8103-24-R-0001',
      naics: '541611',
      contractType: 'FIXED_PRICE',
      setAside: 'SMALL_BUSINESS',
      placeOfPerformance: 'Washington, DC',
      estimatedValueUsd: '$1.5M',
      periodOfPerformance: 'Base year + 4 option years',
      summary: 'Solicitation for enterprise cloud migration services supporting DoD digital transformation.',
    };

    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(data?.summary).toBe(input.summary);
    expect(data?.title).toBe(input.title);
  });

  it('parses with only the required summary field', () => {
    const input = {
      summary: 'A brief summary of the opportunity.',
    };

    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(data?.summary).toBe(input.summary);
    expect(data?.contractType).toBe('UNKNOWN');
    expect(data?.setAside).toBe('UNKNOWN');
  });

  // ── Default values ──

  it('applies default values for contractType and setAside', () => {
    const input = { summary: 'Test summary content.' };

    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(data?.contractType).toBe('UNKNOWN');
    expect(data?.setAside).toBe('UNKNOWN');
  });

  // ── Summary field coercion ──

  it('trims whitespace from summary string', () => {
    const input = { summary: '  Trimmed summary content.  ' };

    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(data?.summary).toBe('Trimmed summary content.');
  });

  it('coerces summary object to JSON string', () => {
    const input = {
      summary: { text: 'This is a summary', details: 'More info' },
    };

    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(data?.summary).toContain('This is a summary');
    expect(typeof data?.summary).toBe('string');
  });

  it('coerces summary array to JSON string', () => {
    const input = {
      summary: ['First sentence.', 'Second sentence.'],
    };

    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(typeof data?.summary).toBe('string');
    expect(data?.summary).toContain('First sentence.');
  });

  it('coerces numeric summary to string', () => {
    const input = { summary: 12345 };

    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(data?.summary).toBe('12345');
  });

  // ── Validation failures ──

  it('rejects empty summary string', () => {
    const input = { summary: '' };

    const { success, error } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(false);
    expect(error?.issues[0]?.message).toBe('Summary must not be empty');
  });

  it('rejects whitespace-only summary', () => {
    const input = { summary: '   ' };

    const { success } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(false);
  });

  it('rejects null summary', () => {
    const input = { summary: null };

    const { success } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(false);
  });

  it('rejects undefined summary (missing field)', () => {
    const input = {};

    const { success } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(false);
  });

  // ── Optional fields ──

  it('allows all optional fields to be omitted', () => {
    const input = { summary: 'Minimal summary.' };

    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(data?.title).toBeUndefined();
    expect(data?.agency).toBeUndefined();
    expect(data?.office).toBeUndefined();
    expect(data?.solicitationNumber).toBeUndefined();
    expect(data?.naics).toBeUndefined();
    expect(data?.placeOfPerformance).toBeUndefined();
    expect(data?.estimatedValueUsd).toBeUndefined();
    expect(data?.periodOfPerformance).toBeUndefined();
  });

  // ── Passthrough (extra fields from LLM) ──

  it('allows extra fields from LLM without failing', () => {
    const input = {
      summary: 'A valid summary.',
      evidence: 'Some evidence text',
      metadata: { source: 'bedrock' },
      extraField: 'should not cause failure',
    };

    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(data?.summary).toBe('A valid summary.');
    // Extra fields are passed through
    expect((data as Record<string, unknown>).evidence).toBe('Some evidence text');
  });

  // ── Edge cases from real LLM responses ──

  it('handles LLM returning null for optional string fields', () => {
    const input = {
      title: null,
      agency: null,
      summary: 'Valid summary text.',
    };

    // The schema uses .nullish() which accepts null, undefined, and the actual type
    // So this should succeed, not fail
    const { success, data } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(true);
    expect(data?.title).toBe(null);
    expect(data?.agency).toBe(null);
    expect(data?.summary).toBe('Valid summary text.');
  });

  it('rejects boolean false as summary (coerced to empty string)', () => {
    const input = { summary: false };

    // false is falsy, so preprocess converts it to String(false || '') = ''
    // which fails the min(1) check — this is correct behavior
    const { success } = QuickSummarySchema.safeParse(input);
    expect(success).toBe(false);
  });
});
