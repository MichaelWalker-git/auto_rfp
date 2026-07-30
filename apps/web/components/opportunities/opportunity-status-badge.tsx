'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  OPPORTUNITY_STATUS_LABELS,
  OPPORTUNITY_STATUS_COLORS,
} from '@auto-rfp/core';
import type { OpportunityStatus } from '@auto-rfp/core';

// ─── Props ────────────────────────────────────────────────────────────────────

interface OpportunityStatusBadgeProps {
  status: OpportunityStatus | undefined;
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Display-only opportunity status badge. Status (including the terminal outcome)
 * is edited exclusively in the opportunity Edit form, not inline.
 */
export const OpportunityStatusBadge = ({ status, className }: OpportunityStatusBadgeProps) => {
  const current = status ?? 'IDENTIFIED';
  return (
    <Badge
      variant="outline"
      className={cn('text-xs h-5 px-1.5 font-medium border', OPPORTUNITY_STATUS_COLORS[current], className)}
    >
      {OPPORTUNITY_STATUS_LABELS[current]}
    </Badge>
  );
};
