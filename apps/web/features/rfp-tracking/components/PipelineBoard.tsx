'use client';

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  APPROVAL_ORDER,
  OPPORTUNITY_APPROVAL_LABELS,
  OPPORTUNITY_APPROVAL_COLORS,
} from '@auto-rfp/core';
import type { RfpPipelineItem, OpportunityApprovalStatus } from '@auto-rfp/core';
import { groupByApprovalStatus } from '../lib/derive-board';
import { PipelineCard } from './PipelineCard';

interface PipelineBoardProps {
  items: RfpPipelineItem[];
  orgId: string;
  nowIso: string;
  /** Whether the caller can perform non-gate stage advances (opportunity:edit). */
  canAdvance: boolean;
}

/**
 * The pipeline board — one column per approval stage in APPROVAL_ORDER. Cards
 * carry the stage-advance actions ("Send for Pre-Sub Review" on I Approved,
 * "Mark Submitted" on II Approved) when the caller can advance.
 */
export function PipelineBoard({ items, orgId, nowIso, canAdvance }: PipelineBoardProps) {
  const grouped = useMemo(
    () => groupByApprovalStatus(items, APPROVAL_ORDER, nowIso),
    [items, nowIso],
  );

  return (
    // Horizontal-scroll kanban: fixed-width columns in a flex row so the board
    // never crams its six columns into a narrow viewport. Below 1280px the row
    // scrolls sideways instead of overflowing the layout.
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-4">
        {APPROVAL_ORDER.map((status) => (
          <BoardColumn
            key={status}
            status={status}
            cards={grouped[status] ?? []}
            orgId={orgId}
            canAdvance={canAdvance}
          />
        ))}
      </div>
    </div>
  );
}

function BoardColumn({
  status,
  cards,
  orgId,
  canAdvance,
}: {
  status: OpportunityApprovalStatus;
  cards: ReturnType<typeof groupByApprovalStatus>[OpportunityApprovalStatus];
  orgId: string;
  canAdvance: boolean;
}) {
  return (
    <div className="flex w-72 shrink-0 flex-col gap-3 rounded-lg bg-slate-50 p-3">
      <div className="flex items-center justify-between">
        <Badge variant="outline" className={cn('text-xs', OPPORTUNITY_APPROVAL_COLORS[status])}>
          {OPPORTUNITY_APPROVAL_LABELS[status]}
        </Badge>
        <span className="text-xs font-medium text-slate-400">{cards.length}</span>
      </div>

      <div className="flex flex-col gap-2">
        {cards.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">No opportunities</p>
        ) : (
          cards.map((card) => (
            <PipelineCard key={card.item.id} card={card} orgId={orgId} canAdvance={canAdvance} />
          ))
        )}
      </div>
    </div>
  );
}
