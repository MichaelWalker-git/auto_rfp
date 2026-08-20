'use client';

import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { formatMissingCoverageCategories, type KBCoverageMissingCategory } from '@auto-rfp/core';
import { Badge } from '@/components/ui/badge';

/** Prefix for the gap badge, reused by the tests and the KB-owner view. */
export const KB_COVERAGE_MISSING_LABEL_PREFIX = 'Missing:';

interface KBCoverageBadgeProps {
  missing: KBCoverageMissingCategory[];
  /**
   * Whether the org's gate blocks on a gap. Only changes the badge's tone —
   * the named list is shown either way, because knowing the gap is the point.
   */
  isBlocking?: boolean;
}

/**
 * Per-document-type coverage badge for the generate dialog. Rendered only for
 * document types that actually have KB requirements — 16 meaningless green
 * ticks would drown the two badges that carry information.
 */
export const KBCoverageBadge = ({ missing, isBlocking = false }: KBCoverageBadgeProps) => {
  if (missing.length === 0) {
    return (
      <Badge
        variant="outline"
        className="text-[10px] px-1.5 py-0 shrink-0 gap-1 border-emerald-200 text-emerald-700"
      >
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        KB ready
      </Badge>
    );
  }

  return (
    <Badge
      variant="outline"
      className={`text-[10px] px-1.5 py-0 shrink-0 gap-1 ${
        isBlocking ? 'border-destructive text-destructive' : 'border-amber-300 text-amber-700'
      }`}
    >
      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
      {KB_COVERAGE_MISSING_LABEL_PREFIX} {formatMissingCoverageCategories(missing)}
    </Badge>
  );
};
