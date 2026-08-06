import { applyFilter, isFilterActive, emptyFilter, ALL, MISSING_FORMS_KEY } from '../FindingsFilterBar';
import type { ComplianceFinding } from '@auto-rfp/core';

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
  finding({ fingerprint: 'a', documentId: 'doc-1', issueType: 'POOR_ANSWER' }),
  finding({ fingerprint: 'b', documentId: 'doc-1', issueType: 'INCONSISTENCY' }),
  finding({ fingerprint: 'c', documentId: 'doc-2', issueType: 'POOR_ANSWER' }),
  finding({ fingerprint: 'd', targetKind: 'FORM_MISSING', documentId: undefined, issueType: 'MISSING_FORM' }),
];

describe('isFilterActive', () => {
  it('is false for the empty filter', () => {
    expect(isFilterActive(emptyFilter)).toBe(false);
  });
  it('is true when a dimension is set', () => {
    expect(isFilterActive({ issueType: 'POOR_ANSWER', documentKey: ALL })).toBe(true);
    expect(isFilterActive({ issueType: ALL, documentKey: 'doc-1' })).toBe(true);
  });
});

describe('applyFilter', () => {
  it('returns everything for the empty filter', () => {
    expect(applyFilter(findings, emptyFilter)).toHaveLength(4);
  });

  it('filters by issue type', () => {
    const res = applyFilter(findings, { issueType: 'POOR_ANSWER', documentKey: ALL });
    expect(res.map((f) => f.fingerprint)).toEqual(['a', 'c']);
  });

  it('filters by document', () => {
    const res = applyFilter(findings, { issueType: ALL, documentKey: 'doc-1' });
    expect(res.map((f) => f.fingerprint)).toEqual(['a', 'b']);
  });

  it('combines type AND document', () => {
    const res = applyFilter(findings, { issueType: 'POOR_ANSWER', documentKey: 'doc-1' });
    expect(res.map((f) => f.fingerprint)).toEqual(['a']);
  });

  it('filters FORM_MISSING findings under the missing-forms bucket', () => {
    const res = applyFilter(findings, { issueType: ALL, documentKey: MISSING_FORMS_KEY });
    expect(res.map((f) => f.fingerprint)).toEqual(['d']);
  });

  it('returns empty when nothing matches', () => {
    const res = applyFilter(findings, { issueType: 'MISSING_FORM', documentKey: 'doc-1' });
    expect(res).toHaveLength(0);
  });
});
