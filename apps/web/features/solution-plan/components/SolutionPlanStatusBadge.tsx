'use client';

import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  SOLUTION_PLAN_BID_DECISION_LABELS,
  SOLUTION_PLAN_STATUS_LABELS,
  type SolutionPlanBidDecision,
  type SolutionPlanStatus,
} from '@auto-rfp/core';
import { SOLUTION_PLAN_RUNNING_STATUSES } from '../lib/status';

const STATUS_CLASSES: Record<SolutionPlanStatus, string> = {
  GRILLING: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  GENERATING_SOT: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  READY: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  FAILED: 'border-red-200 bg-red-50 text-red-700',
};

interface SolutionPlanStatusBadgeProps {
  status: SolutionPlanStatus;
  className?: string;
}

export const SolutionPlanStatusBadge = ({ status, className }: SolutionPlanStatusBadgeProps) => (
  <Badge variant="outline" className={cn(STATUS_CLASSES[status], className)}>
    {SOLUTION_PLAN_RUNNING_STATUSES.includes(status) && (
      <Loader2 className="animate-spin" aria-hidden />
    )}
    {SOLUTION_PLAN_STATUS_LABELS[status]}
  </Badge>
);

interface SolutionPlanBidDecisionBadgeProps {
  bidDecision?: SolutionPlanBidDecision;
  className?: string;
}

/**
 * Destructive "No-Bid" badge rendered next to the READY status when the plan's
 * decision is NO_BID. Renders nothing for BID or legacy plans (no decision).
 */
export const SolutionPlanBidDecisionBadge = ({
  bidDecision,
  className,
}: SolutionPlanBidDecisionBadgeProps) =>
  bidDecision === 'NO_BID' ? (
    <Badge variant="destructive" className={className} data-testid="solution-plan-no-bid-badge">
      {SOLUTION_PLAN_BID_DECISION_LABELS.NO_BID}
    </Badge>
  ) : null;
