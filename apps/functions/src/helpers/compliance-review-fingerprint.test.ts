import { computeFingerprint, normalizeSnippet } from './compliance-review-fingerprint';

describe('normalizeSnippet', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeSnippet('  The   Offeror\n SHALL ')).toBe('the offeror shall');
  });

  it('returns empty string for undefined', () => {
    expect(normalizeSnippet(undefined)).toBe('');
  });
});

describe('computeFingerprint', () => {
  const base = {
    documentId: 'doc-1',
    anchor: { kind: 'heading' as const, text: 'Section L' },
    issueType: 'MISSING_REQUIREMENT',
    snippet: 'The offeror shall provide',
    title: 'Section L not addressed',
  };

  it('is stable for identical input', () => {
    expect(computeFingerprint(base)).toBe(computeFingerprint({ ...base }));
  });

  it('is insensitive to snippet whitespace/case (survives trivial rephrase)', () => {
    const a = computeFingerprint(base);
    const b = computeFingerprint({ ...base, snippet: 'THE   OFFEROR\nSHALL provide' });
    expect(a).toBe(b);
  });

  it('is insensitive to heading case', () => {
    const a = computeFingerprint(base);
    const b = computeFingerprint({ ...base, anchor: { kind: 'heading', text: 'SECTION L' } });
    expect(a).toBe(b);
  });

  it('changes when issueType changes', () => {
    expect(computeFingerprint(base)).not.toBe(computeFingerprint({ ...base, issueType: 'POOR_ANSWER' }));
  });

  it('changes when documentId changes', () => {
    expect(computeFingerprint(base)).not.toBe(computeFingerprint({ ...base, documentId: 'doc-2' }));
  });

  it('distinguishes anchor kinds', () => {
    const heading = computeFingerprint(base);
    const field = computeFingerprint({ ...base, anchor: { kind: 'field', fieldId: 'f-1' } });
    const cell = computeFingerprint({ ...base, anchor: { kind: 'cell', sheet: 'S', row: 1, col: 2 } });
    expect(new Set([heading, field, cell]).size).toBe(3);
  });

  it('handles missing documentId and anchor', () => {
    const fp = computeFingerprint({ issueType: 'MISSING_FORM', snippet: undefined, title: 'x' });
    expect(typeof fp).toBe('string');
    expect(fp.length).toBeGreaterThan(0);
  });

  it('distinguishes two anchorless MISSING_FORM findings by title (regression: F-001 vs F-002)', () => {
    // Both have no documentId/anchor/snippet and the same issueType — only the
    // title differs. They must NOT collapse to one fingerprint, or dedup drops one.
    const offerForm = computeFingerprint({
      issueType: 'MISSING_FORM',
      title: 'No standard offer/solicitation form submitted',
    });
    const repsAndCerts = computeFingerprint({
      issueType: 'MISSING_FORM',
      title: 'No Representations and Certifications form submitted',
    });
    expect(offerForm).not.toBe(repsAndCerts);
  });

  it('changes when the title changes', () => {
    expect(computeFingerprint(base)).not.toBe(computeFingerprint({ ...base, title: 'Different title' }));
  });

  it('is insensitive to title whitespace/case', () => {
    const a = computeFingerprint(base);
    const b = computeFingerprint({ ...base, title: '  SECTION L   NOT addressed ' });
    expect(a).toBe(b);
  });
});
