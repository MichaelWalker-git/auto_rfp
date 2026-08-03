import type { ComplianceFinding } from '@auto-rfp/core';

/**
 * Build the editor URL for a finding, encoding its anchor + snippet so the
 * target editor can jump/highlight (or fall back to snippet-search).
 *
 * - RFP documents → the rich-text editor with ?highlightSection / ?findSnippet
 * - XLSX questionnaires → the RFP document editor (spreadsheet grid) with
 *   ?highlightCell / ?findSnippet — a questionnaire is an RFP document, not a
 *   required form, so it lives under /rfp-documents, NOT /forms
 * - Forms (PDF/XLSX) → the form editor with ?highlightField / ?findSnippet
 * - FORM_MISSING → no target (returns null; the card shows guidance instead)
 */
export const buildFindingHref = (
  orgId: string,
  projectId: string,
  oppId: string,
  finding: ComplianceFinding,
): string | null => {
  if (!finding.documentId || finding.targetKind === 'FORM_MISSING') return null;

  const base = `/organizations/${orgId}/projects/${projectId}/opportunities/${oppId}`;
  const params = new URLSearchParams();
  if (finding.snippet) params.set('findSnippet', finding.snippet);

  if (finding.targetKind === 'RFP_DOCUMENT') {
    if (finding.anchor?.kind === 'heading') params.set('highlightSection', finding.anchor.text);
    return `${base}/rfp-documents/${finding.documentId}/edit?${params.toString()}`;
  }

  if (finding.targetKind === 'XLSX_QUESTIONNAIRE') {
    // The XLSX questionnaire renders in the RFP document editor's spreadsheet
    // grid (QuestionnaireViewer), reached via the /rfp-documents/{id}/edit route.
    if (finding.anchor?.kind === 'cell') {
      params.set('highlightCell', `${finding.anchor.sheet},${finding.anchor.row},${finding.anchor.col}`);
    }
    return `${base}/rfp-documents/${finding.documentId}/edit?${params.toString()}`;
  }

  // XLSX_FORM / PDF_FORM → form editor.
  if (finding.anchor?.kind === 'field') params.set('highlightField', finding.anchor.fieldId);
  if (finding.anchor?.kind === 'cell') {
    params.set('highlightCell', `${finding.anchor.sheet},${finding.anchor.row},${finding.anchor.col}`);
  }
  return `${base}/forms/${finding.documentId}?${params.toString()}`;
};
