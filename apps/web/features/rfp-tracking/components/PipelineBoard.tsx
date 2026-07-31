'use client';

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  RFP_BOARD_STAGE_ORDER,
  RFP_STAGE_LABELS,
  RFP_STAGE_COLORS,
} from '@auto-rfp/core';
import type { RfpPipelineItem, RfpPipelineStage } from '@auto-rfp/core';
import { groupByStage } from '../lib/derive-board';
import { PipelineCard } from './PipelineCard';

interface PipelineBoardProps {
  items: RfpPipelineItem[];
  orgId: string;
  nowIso: string;
  /** Whether the caller can perform non-gate stage advances (opportunity:edit). */
  canAdvance: boolean;
}

/**
 * The pipeline board — one column per stage in RFP_BOARD_STAGE_ORDER, mirroring
 * the Linear "Government Contracting" board (open funnel → expired → terminal
 * outcomes). Cards carry the stage-advance actions ("Send for Pre-Sub Review",
 * "Mark Submitted") when the caller can advance.
 */
export function PipelineBoard({ items, orgId, nowIso, canAdvance }: PipelineBoardProps) {
  const grouped = useMemo(
    () => groupByStage(items, RFP_BOARD_STAGE_ORDER, nowIso),
    [items, nowIso],
  );

  return (
    // The board has 11 stages; a horizontally-scrollable row of fixed-width
    // columns is the readable layout (matching Linear's own board). Only the
    // board scrolls, not the page.
    <div className="flex gap-3 overflow-x-auto pb-2">
      {RFP_BOARD_STAGE_ORDER.map((stage) => (
        <BoardColumn
          key={stage}
          stage={stage}
          cards={grouped[stage] ?? []}
          orgId={orgId}
          canAdvance={canAdvance}
        />
      ))}
    </div>
  );
}

function BoardColumn({
  stage,
  cards,
  orgId,
  canAdvance,
}: {
  stage: RfpPipelineStage;
  cards: ReturnType<typeof groupByStage>[RfpPipelineStage];
  orgId: string;
  canAdvance: boolean;
}) {
  return (
    <div className="flex w-64 shrink-0 flex-col gap-3 rounded-lg bg-muted p-2.5">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className={cn('text-xs', RFP_STAGE_COLORS[stage])}>
          {RFP_STAGE_LABELS[stage]}
        </Badge>
        <span className="text-xs font-medium text-muted-foreground">{cards.length}</span>
      </div>

      <div className="flex flex-col gap-2">
        {cards.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">No opportunities</p>
        ) : (
          cards.map((card) => (
            <PipelineCard key={card.item.id} card={card} orgId={orgId} canAdvance={canAdvance} />
          ))
        )}
      </div>
    </div>
  );
}
