import { buildFindingHref } from '../navigateToFinding';
import type { ComplianceFinding } from '@auto-rfp/core';

const base: ComplianceFinding = {
  findingId: 'f1',
  fingerprint: 'fp1',
  targetKind: 'RFP_DOCUMENT',
  documentId: 'doc-1',
  issueType: 'POOR_ANSWER',
  severity: 'minor',
  title: 't',
  description: 'd',
  anchorValid: true,
};

const parse = (href: string) => {
  const [path, query] = href.split('?');
  return { path, params: new URLSearchParams(query) };
};

describe('buildFindingHref', () => {
  it('returns null for a FORM_MISSING finding', () => {
    expect(
      buildFindingHref('o', 'p', 'opp', { ...base, targetKind: 'FORM_MISSING', documentId: undefined }),
    ).toBeNull();
  });

  it('routes an RFP document to the rich-text editor with heading + snippet params', () => {
    const href = buildFindingHref('o', 'p', 'opp', {
      ...base,
      anchor: { kind: 'heading', text: 'Section L' },
      snippet: 'the offeror shall',
    });
    const { path, params } = parse(href!);
    expect(path).toBe('/organizations/o/projects/p/opportunities/opp/rfp-documents/doc-1/edit');
    expect(params.get('highlightSection')).toBe('Section L');
    expect(params.get('findSnippet')).toBe('the offeror shall');
  });

  it('routes a PDF form to the form editor with a field param', () => {
    const href = buildFindingHref('o', 'p', 'opp', {
      ...base,
      targetKind: 'PDF_FORM',
      anchor: { kind: 'field', fieldId: 'field-9' },
    });
    const { path, params } = parse(href!);
    expect(path).toBe('/organizations/o/projects/p/opportunities/opp/forms/doc-1');
    expect(params.get('highlightField')).toBe('field-9');
  });

  it('routes an XLSX questionnaire to the RFP document editor (NOT /forms) with a cell param', () => {
    const href = buildFindingHref('o', 'p', 'opp', {
      ...base,
      targetKind: 'XLSX_QUESTIONNAIRE',
      documentId: 'q-1',
      anchor: { kind: 'cell', sheet: 'Pricing', row: 4, col: 2 },
    });
    const { path, params } = parse(href!);
    // A questionnaire is an RFP document (spreadsheet grid), not a required form.
    expect(path).toBe('/organizations/o/projects/p/opportunities/opp/rfp-documents/q-1/edit');
    expect(params.get('highlightCell')).toBe('Pricing,4,2');
  });

  it('routes an XLSX FORM cell anchor to the form editor', () => {
    const href = buildFindingHref('o', 'p', 'opp', {
      ...base,
      targetKind: 'XLSX_FORM',
      documentId: 'form-2',
      anchor: { kind: 'cell', sheet: 'Sheet1', row: 1, col: 0 },
    });
    const { path, params } = parse(href!);
    expect(path).toBe('/organizations/o/projects/p/opportunities/opp/forms/form-2');
    expect(params.get('highlightCell')).toBe('Sheet1,1,0');
  });

  it('omits anchor params when there is no anchor but keeps the snippet', () => {
    const href = buildFindingHref('o', 'p', 'opp', { ...base, snippet: 'find me' });
    const { params } = parse(href!);
    expect(params.get('highlightSection')).toBeNull();
    expect(params.get('findSnippet')).toBe('find me');
  });
});
