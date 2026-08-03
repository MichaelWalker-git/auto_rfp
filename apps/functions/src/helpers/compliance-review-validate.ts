/**
 * Server-side finding validation — the real enforcement layer.
 *
 * The model can misremember a heading, invent a fieldId, or fabricate a snippet.
 * Rather than trust its output, we verify each finding against the real package
 * inventory + document text and set `anchorValid` accordingly. An invalid anchor
 * does NOT drop the finding (the judgment may still be real) — it degrades the
 * UI to snippet-search / show-and-read. We also compute the stable fingerprint
 * here so decisions can be matched across runs.
 */
import { computeFingerprint, normalizeSnippet } from '@/helpers/compliance-review-fingerprint';
import { loadRFPDocumentHtml } from '@/helpers/rfp-document';
import { stripHtml } from '@/helpers/compliance-review-html';
import type { PackageInventory } from '@/helpers/compliance-review-tools';
import type { ComplianceFinding, FindingAnchor } from '@auto-rfp/core';

/** A finding as emitted by the model (pre-validation): no fingerprint, anchorValid unset. */
export type RawFinding = Omit<ComplianceFinding, 'fingerprint' | 'anchorValid'> & {
  fingerprint?: string;
  anchorValid?: boolean;
};

const anchorExists = (
  anchor: FindingAnchor | undefined,
  documentId: string | undefined,
  inventory: PackageInventory,
): boolean => {
  if (!anchor) return false;
  switch (anchor.kind) {
    case 'heading': {
      const doc = inventory.documents.find((d) => d.documentId === documentId);
      const target = anchor.text.trim().toLowerCase();
      return !!doc && doc.headings.some((h) => h.trim().toLowerCase() === target);
    }
    case 'field': {
      const form = inventory.forms.find((f) => f.formId === documentId);
      return !!form && form.fields.some((f) => f.fieldId === anchor.fieldId);
    }
    case 'cell': {
      // XLSX questionnaire cell: valid when the owning document has a cell
      // inventory whose (sheet name, 0-based row, col) matches a real filled
      // cell — the same coordinates the editor navigates to.
      const doc = inventory.documents.find((d) => d.documentId === documentId);
      const cells = doc?.questionnaireCells;
      if (!cells) return false;
      if (cells.sheetName.trim().toLowerCase() !== anchor.sheet.trim().toLowerCase()) return false;
      return cells.cells.some((c) => c.row === anchor.row && c.col === anchor.col);
    }
  }
};

/**
 * Recover a missing `documentId`/`documentTitle` from the finding's anchor or
 * title. The model often pins a finding to an exact fieldId/heading but forgets
 * to also emit the owning documentId — which would leave the finding with no
 * "Go to spot" link in the UI (buildFindingHref needs documentId). Since the
 * anchor already identifies the target unambiguously against the inventory, we
 * back-fill the id here rather than trust the model to have populated it.
 * Returns the id/title to use (possibly the originals unchanged).
 */
const recoverDocumentRef = (
  raw: RawFinding,
  inventory: PackageInventory,
): { documentId?: string; documentTitle?: string } => {
  let documentId = raw.documentId;
  let documentTitle = raw.documentTitle;

  if (!documentId && raw.anchor) {
    if (raw.anchor.kind === 'field') {
      const fieldId = raw.anchor.fieldId;
      const form = inventory.forms.find((f) => f.fields.some((fl) => fl.fieldId === fieldId));
      if (form) {
        documentId = form.formId;
        documentTitle = documentTitle ?? form.name;
      }
    } else if (raw.anchor.kind === 'heading') {
      const target = raw.anchor.text.trim().toLowerCase();
      const matches = inventory.documents.filter((d) =>
        d.headings.some((h) => h.trim().toLowerCase() === target),
      );
      // Only recover when a single document owns the heading — an ambiguous
      // heading shared across docs can't be resolved from the anchor alone.
      if (matches.length === 1) {
        documentId = matches[0].documentId;
        documentTitle = documentTitle ?? matches[0].title;
      }
    }
  }

  // Last resort: the model gave a documentTitle but no id — match it to the
  // inventory by exact (normalized) title/name so the finding still links.
  if (!documentId && documentTitle) {
    const target = documentTitle.trim().toLowerCase();
    const doc = inventory.documents.find((d) => d.title.trim().toLowerCase() === target);
    const form = inventory.forms.find((f) => f.name.trim().toLowerCase() === target);
    if (doc) documentId = doc.documentId;
    else if (form) documentId = form.formId;
  }

  return { documentId, documentTitle };
};

/**
 * Validate + fingerprint a batch of raw findings against the package.
 * `docTextCache` avoids re-loading the same document HTML for snippet checks.
 */
export const validateAndTagFindings = async (
  rawFindings: RawFinding[],
  inventory: PackageInventory,
): Promise<ComplianceFinding[]> => {
  const docTextCache = new Map<string, string>();

  const loadDocText = async (documentId: string): Promise<string> => {
    if (docTextCache.has(documentId)) return docTextCache.get(documentId)!;
    const doc = inventory.documents.find((d) => d.documentId === documentId);
    let text = '';
    if (doc?.htmlContentKey) {
      try {
        text = stripHtml(await loadRFPDocumentHtml(doc.htmlContentKey)).toLowerCase();
      } catch {
        text = '';
      }
    }
    docTextCache.set(documentId, text);
    return text;
  };

  const results: ComplianceFinding[] = [];
  // Two findings that collapse to the same fingerprint ARE the same finding
  // (same doc + anchor + issueType + normalized snippet). Keep the first and
  // drop later duplicates so storage/UI never carry — or re-key — the same item.
  const seenFingerprints = new Set<string>();
  for (const raw of rawFindings) {
    // Back-fill a missing documentId/title from the anchor so the finding keeps
    // its "Go to spot" link even when the model omitted the id.
    const { documentId, documentTitle } = recoverDocumentRef(raw, inventory);

    // Verify the snippet is a genuine substring of the target document (RFP docs only).
    let snippetValid = false;
    if (raw.snippet && documentId && raw.targetKind === 'RFP_DOCUMENT') {
      const normalizedSnippet = normalizeSnippet(raw.snippet);
      if (normalizedSnippet) {
        const docText = await loadDocText(documentId);
        // stripHtml already collapses whitespace; normalize the haystack the same way.
        snippetValid = docText.replace(/\s+/g, ' ').includes(normalizedSnippet);
      }
    }

    const anchorOk = anchorExists(raw.anchor, documentId, inventory);
    const fingerprint = computeFingerprint({
      documentId,
      anchor: raw.anchor,
      issueType: raw.issueType,
      snippet: raw.snippet,
      title: raw.title,
    });

    if (seenFingerprints.has(fingerprint)) continue;
    seenFingerprints.add(fingerprint);

    results.push({
      ...raw,
      documentId,
      documentTitle,
      fingerprint,
      // Anchor is "valid" (jump directly) only if the addressable target exists.
      // Field (form) and cell (XLSX questionnaire) anchors resolve to a discrete
      // grid target, so existence in the inventory is sufficient. Heading anchors
      // (RFP-doc HTML) additionally require the snippet to check out so the
      // outline lands on real content.
      anchorValid:
        raw.anchor?.kind === 'field' || raw.anchor?.kind === 'cell'
          ? anchorOk
          : anchorOk && (raw.snippet ? snippetValid : true),
    });
  }

  return results;
};
