'use client';

import type { NotarySummary } from '@auto-rfp/core';
import { Badge } from '@/components/ui/badge';
import { notaryChipLabel } from '@/features/required-forms/lib/notary-ui';

interface OpportunityNotaryChipProps {
  summary: NotarySummary | null | undefined;
}

/**
 * Opportunity-card rollup chip (FR5.3). Renders nothing when there is no
 * summary or nothing is flagged; otherwise a small "⚖ Notary: N forms" chip
 * where `N = requiredCount + possiblyRequiredCount`, with an `aria-label`
 * naming the count for assistive tech (NFR7.1).
 */
export const OpportunityNotaryChip = ({ summary }: OpportunityNotaryChipProps) => {
  const label = notaryChipLabel(summary);
  if (!label || !summary) return null;

  const count = summary.requiredCount + summary.possiblyRequiredCount;
  // count 0 = flagged by a solicitation-level instruction, not a specific form.
  const ariaLabel =
    count > 0
      ? `${count} ${count === 1 ? 'form needs' : 'forms need'} notarization`
      : 'Notarization required for this opportunity';

  return (
    <Badge
      variant="outline"
      className="text-xs h-4 px-1 bg-amber-100 text-amber-800 border-amber-200"
      data-testid="opportunity-notary-chip"
      aria-label={ariaLabel}
    >
      {label}
    </Badge>
  );
};
