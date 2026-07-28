'use client';

import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CalendarClock, User, Clock, ArrowRight, Send } from 'lucide-react';
import { OPPORTUNITY_APPROVAL_LABELS, OPPORTUNITY_APPROVAL_COLORS } from '@auto-rfp/core';
import type { BoardCard } from '../lib/derive-board';
import { useApprovalAdvance } from '../hooks/use-approval-advance';
import {
  formatCurrency,
  DEADLINE_BADGE_CLASSES,
  deadlineLabel,
} from '../lib/format';

interface PipelineCardProps {
  card: BoardCard;
  orgId: string;
  /** Whether stage-advance actions render (opportunity:edit). */
  canAdvance: boolean;
}

/**
 * Board card. Links to the opportunity detail route when the item carries a
 * projectId, and — for the advanceable stages — shows a stage-advance action:
 *   I_APPROVED  → "Send for Pre-Sub Review"
 *   II_APPROVED → "Mark Submitted"
 */
export function PipelineCard({ card, orgId, canAdvance }: PipelineCardProps) {
  const { item, approvalStatus, daysInCurrentStage, deadlineUrgency, daysToDeadline } = card;
  const { advance, pendingOppId } = useApprovalAdvance(orgId);

  const oppId = item.oppId ?? item.id;
  const detailHref =
    item.projectId && oppId
      ? `/organizations/${orgId}/projects/${item.projectId}/opportunities/${oppId}`
      : null;

  const isPending = pendingOppId === oppId;

  const header = (
    <>
      <p className="line-clamp-2 text-sm font-medium text-slate-800">{item.title}</p>
      {item.solicitationNumber && (
        <p className="text-xs text-slate-400">{item.solicitationNumber}</p>
      )}
    </>
  );

  const advanceAction =
    canAdvance && item.projectId && approvalStatus === 'I_APPROVED' ? (
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        disabled={isPending}
        onClick={() => advance({ projectId: item.projectId!, oppId, to: 'PRE_SUB_APPROVAL' })}
      >
        <ArrowRight className="h-3.5 w-3.5" />
        Send for Pre-Sub Review
      </Button>
    ) : canAdvance && item.projectId && approvalStatus === 'II_APPROVED' ? (
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        disabled={isPending}
        onClick={() => advance({ projectId: item.projectId!, oppId, to: 'SUBMITTED' })}
      >
        <Send className="h-3.5 w-3.5" />
        Mark Submitted
      </Button>
    ) : null;

  return (
    <Card className="transition-colors hover:border-indigo-300">
      <CardContent className="space-y-2 p-3">
        {detailHref ? (
          <Link href={detailHref} className="block">
            {header}
          </Link>
        ) : (
          header
        )}

        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={cn('text-xs', OPPORTUNITY_APPROVAL_COLORS[approvalStatus])}>
            {OPPORTUNITY_APPROVAL_LABELS[approvalStatus]}
          </Badge>
          <Badge variant="outline" className={cn('gap-1 text-xs', DEADLINE_BADGE_CLASSES[deadlineUrgency])}>
            <CalendarClock className="h-3 w-3" />
            {deadlineLabel(deadlineUrgency, daysToDeadline)}
          </Badge>
          {daysInCurrentStage !== null && (
            <Badge variant="outline" className="gap-1 text-xs text-slate-600">
              <Clock className="h-3 w-3" />
              {daysInCurrentStage}d in stage
            </Badge>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-slate-500">
          <span className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {item.assigneeName ?? 'Unassigned'}
          </span>
          <span className="font-medium text-slate-700">
            {formatCurrency(item.baseAndAllOptionsValue)}
          </span>
        </div>

        {advanceAction}
      </CardContent>
    </Card>
  );
}
