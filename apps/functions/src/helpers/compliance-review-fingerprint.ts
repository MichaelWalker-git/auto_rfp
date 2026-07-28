/**
 * Stable fingerprint for a compliance finding.
 *
 * Findings are recomputed on every run (latest-run authoritative), but user
 * Decisions (dismiss/resolve) must survive re-runs. The fingerprint gives a
 * finding a stable identity independent of the run that produced it, so a
 * dismissed finding stays dismissed and a resolved finding that re-appears can
 * be reactivated.
 *
 * Identity = documentId + anchor + issueType + normalized(snippet).
 * Normalization (lowercase + whitespace-collapse) means trivial re-phrasing by
 * the model doesn't defeat the match. If the model rewords substantially the
 * fingerprint changes and a dismissed finding resurfaces once — accepted for MVP.
 */
import { createHash } from 'node:crypto';
import type { FindingAnchor } from '@auto-rfp/core';

/** Lowercase and collapse all whitespace to single spaces. */
export const normalizeSnippet = (snippet: string | undefined): string =>
  (snippet ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Canonical string form of an anchor (stable across runs for the same spot). */
const anchorKey = (anchor: FindingAnchor | undefined): string => {
  if (!anchor) return 'none';
  switch (anchor.kind) {
    case 'heading':
      return `heading:${anchor.text.toLowerCase().replace(/\s+/g, ' ').trim()}`;
    case 'cell':
      return `cell:${anchor.sheet}:${anchor.row}:${anchor.col}`;
    case 'field':
      return `field:${anchor.fieldId}`;
  }
};

export const computeFingerprint = (finding: {
  documentId?: string;
  anchor?: FindingAnchor;
  issueType: string;
  snippet?: string;
  title: string;
}): string => {
  const parts = [
    finding.documentId ?? 'no-doc',
    anchorKey(finding.anchor),
    finding.issueType,
    normalizeSnippet(finding.snippet),
    // Title is the discriminator for findings with no anchor/snippet/documentId
    // (e.g. two distinct MISSING_FORM findings). Without it they collapse to the
    // same hash and dedup would silently drop a real, distinct finding.
    normalizeSnippet(finding.title),
  ];
  return createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 32);
};
