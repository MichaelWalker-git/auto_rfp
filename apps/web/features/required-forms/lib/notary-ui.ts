import { Stamp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { NotaryStatus, NotaryCue, NotarySummary } from '@auto-rfp/core';

/**
 * Pure presentation-mapping helpers for the notary UI (u3-notary-ui).
 *
 * No React / no JSX here — these map the u2-produced `NotaryStatus`, `NotaryCue`
 * and `NotarySummary` values onto the visual tokens the presentational
 * components render. Keeping the mapping here keeps the components logic-free
 * and unit-testable (NFR6.1).
 */

/** Semantic colour tone for a flagged notary badge. Mapped to Tailwind classes in the component. */
export type NotaryBadgeTone = 'amber' | 'yellow';

export interface NotaryBadgeVariant {
  /** Semantic colour tone — `amber` for REQUIRED, `yellow` for POSSIBLY_REQUIRED. */
  variant: NotaryBadgeTone;
  /** Human-readable badge label. */
  label: string;
  /** Lucide icon component reference (rendered by the component, never colour alone). */
  icon: LucideIcon;
}

/**
 * Map a notary status to its badge visual tokens.
 *
 * Returns `null` for `NOT_REQUIRED` (and any unexpected/falsy value) so the
 * badge renders nothing — the zero-noise default. Only the two flagged statuses
 * produce a badge.
 */
export const notaryBadgeVariant = (
  status: NotaryStatus | null | undefined,
): NotaryBadgeVariant | null => {
  switch (status) {
    case 'REQUIRED':
      return { variant: 'amber', label: 'Notary required', icon: Stamp };
    case 'POSSIBLY_REQUIRED':
      return { variant: 'yellow', label: 'Notary — review needed', icon: Stamp };
    default:
      return null;
  }
};

/**
 * Build the opportunity-card rollup chip label.
 *
 * Returns `null` when there is no summary or nothing is flagged
 * (`!anyNotaryRequired`) so the chip renders nothing. Otherwise
 * `"⚖ Notary: N form(s)"` where `N = requiredCount + possiblyRequiredCount`
 * (per-form counts). When `anyNotaryRequired` is true but no individual form
 * is flagged — a solicitation-level instruction like "all bids must be
 * notarized" — the label carries no count: `"⚖ Notary required"`.
 */
export const notaryChipLabel = (
  summary: NotarySummary | null | undefined,
): string | null => {
  if (!summary || !summary.anyNotaryRequired) return null;
  const count = summary.requiredCount + summary.possiblyRequiredCount;
  if (count === 0) return '⚖ Notary required';
  return `⚖ Notary: ${count} ${count === 1 ? 'form' : 'forms'}`;
};

const CUE_LABELS: Record<NotaryCue, string> = {
  KEYWORD: 'Keyword match',
  ACK_BLOCK: 'Acknowledgment block',
  STATE_COUNTY: 'State / county line',
  COMMISSION: 'Commission reference',
  SWORN: 'Sworn statement',
  WITNESS: 'Witness line',
  INSTRUCTIONAL: 'Instructional text',
};

/** Human-readable label for a notary cue. Falls back to the raw value defensively. */
export const cueLabel = (cue: NotaryCue): string => CUE_LABELS[cue] ?? cue;
