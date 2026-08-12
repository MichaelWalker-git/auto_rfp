'use client';

import { Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { SOLUTION_PLAN_STATUS_LABELS, type SolutionPlanStatus } from '@auto-rfp/core';

const STATUS_CLASSES: Record<SolutionPlanStatus, string> = {
  GRILLING: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  GENERATING_SOT: 'border-indigo-200 bg-indigo-50 text-indigo-700',
  READY: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  FAILED: 'border-red-200 bg-red-50 text-red-700',
};

const RUNNING_STATUSES: SolutionPlanStatus[] = ['GRILLING', 'GENERATING_SOT'];

interface SolutionPlanStatusBadgeProps {
  status: SolutionPlanStatus;
  className?: string;
}

export const SolutionPlanStatusBadge = ({ status, className }: SolutionPlanStatusBadgeProps) => (
  <Badge variant="outline" className={cn(STATUS_CLASSES[status], className)}>
    {RUNNING_STATUSES.includes(status) && <Loader2 className="animate-spin" aria-hidden />}
    {SOLUTION_PLAN_STATUS_LABELS[status]}
  </Badge>
);
