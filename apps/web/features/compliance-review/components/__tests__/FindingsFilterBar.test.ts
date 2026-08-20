import { applyFilter, isFilterActive, emptyFilter, ALL, MISSING_FORMS_KEY, type FindingsFilter } from '../FindingsFilterBar';
import type { ComplianceFinding } from '@auto-rfp/core';

// Build a filter from a partial, defaulting every dimension to ALL.
const filter = (over: Partial<FindingsFilter> = {}): FindingsFilter => ({
  issueType: ALL,
  documentKey: ALL,
  severity: ALL,
  ...over,
});

const finding = (over: Partial<ComplianceFinding>): ComplianceFinding => ({
  findingId: 'f',
  fingerprint: 'fp',
  targetKind: 'RFP_DOCUMENT',
  documentId: 'doc-1',
  issueType: 'POOR_ANSWER',
  severity: 'minor',
  title: 't',
  description: 'd',
  anchorValid: false,
  ...over,
});

const findings: ComplianceFinding[] = [
  finding({ fingerprint: 'a', documentId: 'doc-1', issueType: 'POOR_ANSWER', severity: 'critical' }),
  finding({ fingerprint: 'b', documentId: 'doc-1', issueType: 'INCONSISTENCY', severity: 'minor' }),
  finding({ fingerprint: 'c', documentId: 'doc-2', issueType: 'POOR_ANSWER', severity: 'critical' }),
  finding({ fingerprint: 'd', targetKind: 'FORM_MISSING', documentId: undefined, issueType: 'MISSING_FORM', severity: 'major' }),
];

describe('isFilterActive', () => {
  it('is false for the empty filter', () => {
    expect(isFilterActive(emptyFilter)).toBe(false);
  });
  it('is true when a dimension is set', () => {
    expect(isFilterActive(filter({ issueType: 'POOR_ANSWER' }))).toBe(true);
    expect(isFilterActive(filter({ documentKey: 'doc-1' }))).toBe(true);
    expect(isFilterActive(filter({ severity: 'critical' }))).toBe(true);
  });
});

describe('applyFilter', () => {
  it('returns everything for the empty filter', () => {
    expect(applyFilter(findings, emptyFilter)).toHaveLength(4);
  });

  it('filters by issue type', () => {
    const res = applyFilter(findings, filter({ issueType: 'POOR_ANSWER' }));
    expect(res.map((f) => f.fingerprint)).toEqual(['a', 'c']);
  });

  it('filters by document', () => {
    const res = applyFilter(findings, filter({ documentKey: 'doc-1' }));
    expect(res.map((f) => f.fingerprint)).toEqual(['a', 'b']);
  });

  it('filters by severity', () => {
    const res = applyFilter(findings, filter({ severity: 'critical' }));
    expect(res.map((f) => f.fingerprint)).toEqual(['a', 'c']);
  });

  it('combines type AND document', () => {
    const res = applyFilter(findings, filter({ issueType: 'POOR_ANSWER', documentKey: 'doc-1' }));
    expect(res.map((f) => f.fingerprint)).toEqual(['a']);
  });

  it('combines severity AND issue type', () => {
    // critical ∩ poor-answer → a, c ; a minor inconsistency (b) is excluded.
    const res = applyFilter(findings, filter({ severity: 'critical', issueType: 'POOR_ANSWER' }));
    expect(res.map((f) => f.fingerprint)).toEqual(['a', 'c']);
  });

  it('filters FORM_MISSING findings under the missing-forms bucket', () => {
    const res = applyFilter(findings, filter({ documentKey: MISSING_FORMS_KEY }));
    expect(res.map((f) => f.fingerprint)).toEqual(['d']);
  });

  it('returns empty when nothing matches', () => {
    const res = applyFilter(findings, filter({ issueType: 'MISSING_FORM', documentKey: 'doc-1' }));
    expect(res).toHaveLength(0);
  });
});
