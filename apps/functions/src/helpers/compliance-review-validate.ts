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
    case 'cell':
      // Cell anchors (XLSX questionnaires) aren't in the inventory yet; treat as
      // unvalidated → the snippet fallback covers navigation. Phase 2 adds cell inventory.
      return false;
  }
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
    // Verify the snippet is a genuine substring of the target document (RFP docs only).
    let snippetValid = false;
    if (raw.snippet && raw.documentId && raw.targetKind === 'RFP_DOCUMENT') {
      const normalizedSnippet = normalizeSnippet(raw.snippet);
      if (normalizedSnippet) {
        const docText = await loadDocText(raw.documentId);
        // stripHtml already collapses whitespace; normalize the haystack the same way.
        snippetValid = docText.replace(/\s+/g, ' ').includes(normalizedSnippet);
      }
    }

    const anchorOk = anchorExists(raw.anchor, raw.documentId, inventory);
    const fingerprint = computeFingerprint({
      documentId: raw.documentId,
      anchor: raw.anchor,
      issueType: raw.issueType,
      snippet: raw.snippet,
      title: raw.title,
    });

    if (seenFingerprints.has(fingerprint)) continue;
    seenFingerprints.add(fingerprint);

    results.push({
      ...raw,
      fingerprint,
      // Anchor is "valid" (jump directly) only if the addressable target exists.
      // For RFP docs we additionally require the snippet to check out so the
      // outline lands on real content; forms rely on the fieldId alone.
      anchorValid:
        raw.anchor?.kind === 'field'
          ? anchorOk
          : anchorOk && (raw.snippet ? snippetValid : true),
    });
  }

  return results;
};
