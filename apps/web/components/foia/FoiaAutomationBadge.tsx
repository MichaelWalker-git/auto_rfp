'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  FOIA_AUTOMATION_STATE_LABELS,
  FOIA_AUTOMATION_STATE_COLORS,
  isFoiaFailureState,
  isFoiaPendingState,
} from '@auto-rfp/core';
import type { FoiaAutomationState } from '@auto-rfp/core';
import { AlertTriangle, Clock, CheckCircle2 } from 'lucide-react';

// ─── Props ────────────────────────────────────────────────────────────────────

interface FoiaAutomationBadgeProps {
  state?: FoiaAutomationState | null;
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Display-only FOIA automation state badge.
 * Renders nothing for null/undefined/NOT_APPLICABLE states.
 */
export const FoiaAutomationBadge = ({ state, className }: FoiaAutomationBadgeProps) => {
  if (!state || state === 'NOT_APPLICABLE') {
    return null;
  }

  let Icon = Clock;
  if (isFoiaFailureState(state)) {
    Icon = AlertTriangle;
  } else if (state === 'SENT' || state === 'MANUAL_COMPLETED') {
    Icon = CheckCircle2;
  } else if (isFoiaPendingState(state)) {
    Icon = Clock;
  }

  return (
    <Badge
      variant="outline"
      className={cn(
        'text-xs h-5 px-1.5 font-medium border flex items-center gap-1',
        FOIA_AUTOMATION_STATE_COLORS[state],
        className
      )}
    >
      <Icon className="h-3 w-3" />
      {FOIA_AUTOMATION_STATE_LABELS[state]}
    </Badge>
  );
};
