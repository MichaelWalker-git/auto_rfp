'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CalendarClock, User, Clock, Send } from 'lucide-react';
import { RFP_STAGE_LABELS, RFP_STAGE_COLORS } from '@auto-rfp/core';
import { FoiaAutomationBadge } from '@/components/foia/FoiaAutomationBadge';
import { PhysicalSubmissionChip } from '@/components/opportunities/PhysicalSubmissionChip';
import type { BoardCard } from '../lib/derive-board';
import { useApprovalAdvance } from '../hooks/use-approval-advance';
import {
  formatCurrency,
  DEADLINE_BADGE_CLASSES,
  deadlineLabel,
} from '../lib/format';
import { PipelineCardDetail } from './PipelineCardDetail';

interface PipelineCardProps {
  card: BoardCard;
  orgId: string;
  /** Whether stage-advance actions render (opportunity:edit). */
  canAdvance: boolean;
}

/**
 * Board card. Clicking the card body opens a detail panel (transition history,
 * links to the full opportunity + the source Linear issue). For the advanceable
 * stages it also shows a stage-advance action:
 *   II_APPROVED → "Mark Submitted"
 * (The First approved / In progress stages carry no advance button.) The advance
 * button sits outside the click target so acting on it never opens the panel.
 */
export function PipelineCard({ card, orgId, canAdvance }: PipelineCardProps) {
  const { item, stage, approvalStatus, daysInCurrentStage, deadlineUrgency, daysToDeadline } = card;
  const { advance, pendingOppId } = useApprovalAdvance(orgId);
  const [detailOpen, setDetailOpen] = useState(false);

  const oppId = item.oppId ?? item.id;
  const isPending = pendingOppId === oppId;

  const advanceAction =
    canAdvance && item.projectId && approvalStatus === 'II_APPROVED' ? (
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
    <>
      <Card className="transition-colors hover:border-primary/50">
        <CardContent className="space-y-2 p-3">
          {/*
           * The whole summary is one interactive element that opens the detail
           * panel. Keeping it a real <button> (not a div) preserves keyboard
           * access, and keeping the advance <Button> a sibling below avoids a
           * nested-interactive-element a11y violation.
           */}
          <button
            type="button"
            onClick={() => setDetailOpen(true)}
            className="w-full space-y-2 text-left"
            aria-haspopup="dialog"
          >
            <div>
              <p className="line-clamp-2 text-sm font-medium text-foreground">{item.title}</p>
              {item.solicitationNumber && (
                <p className="text-xs text-muted-foreground">{item.solicitationNumber}</p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className={cn('text-xs', RFP_STAGE_COLORS[stage])}>
                {RFP_STAGE_LABELS[stage]}
              </Badge>
              {/*
               * The deadline badge is moot once the response is in — a submitted
               * RFP would otherwise show a misleading red "Overdue Nd", so drop it
               * on that stage only.
               */}
              {stage !== 'submitted' && (
                <Badge variant="outline" className={cn('gap-1 text-xs', DEADLINE_BADGE_CLASSES[deadlineUrgency])}>
                  <CalendarClock className="h-3 w-3" />
                  {deadlineLabel(deadlineUrgency, daysToDeadline)}
                </Badge>
              )}
              {daysInCurrentStage !== null && (
                <Badge variant="outline" className="gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {daysInCurrentStage}d in stage
                </Badge>
              )}
              <FoiaAutomationBadge state={item.foiaAutomationState} />
              <PhysicalSubmissionChip submissionMethod={item.submissionMethod} />
            </div>

            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {item.assigneeName ?? 'Unassigned'}
              </span>
              <span className="font-medium text-foreground">
                {formatCurrency(item.baseAndAllOptionsValue)}
              </span>
            </div>
          </button>

          {advanceAction}
        </CardContent>
      </Card>

      <PipelineCardDetail
        item={item}
        orgId={orgId}
        open={detailOpen}
        onOpenChange={setDetailOpen}
      />
    </>
  );
}
