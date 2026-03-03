'use client';

import { useState } from 'react';
import { ChevronDown, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import { updateOpportunityStageApi } from '@/lib/hooks/use-opportunity-stage';
import {
  OPPORTUNITY_STAGE_LABELS,
  OPPORTUNITY_STAGE_COLORS,
  ACTIVE_OPPORTUNITY_STAGES,
  TERMINAL_OPPORTUNITY_STAGES,
} from '@auto-rfp/core';
import type { OpportunityStage } from '@auto-rfp/core';

// ─── Stage order for the dropdown ────────────────────────────────────────────

const STAGE_ORDER: OpportunityStage[] = [
  'IDENTIFIED',
  'QUALIFYING',
  'PURSUING',
  'SUBMITTED',
  'WON',
  'LOST',
  'NO_BID',
  'WITHDRAWN',
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface OpportunityStageBadgeProps {
  stage: OpportunityStage | undefined;
  /** If provided, shows a dropdown to change the stage */
  orgId?: string;
  projectId?: string;
  oppId?: string;
  onStageChanged?: (newStage: OpportunityStage) => void;
  /** If true, shows the dropdown for manual stage changes */
  editable?: boolean;
  className?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const OpportunityStageBadge = ({
  stage,
  orgId,
  projectId,
  oppId,
  onStageChanged,
  editable = false,
  className,
}: OpportunityStageBadgeProps) => {
  const { toast } = useToast();
  const [currentStage, setCurrentStage] = useState<OpportunityStage>(stage ?? 'IDENTIFIED');
  const [isUpdating, setIsUpdating] = useState(false);

  // Sync with prop changes
  if (stage && stage !== currentStage && !isUpdating) {
    setCurrentStage(stage);
  }

  const colorClass = OPPORTUNITY_STAGE_COLORS[currentStage];
  const label = OPPORTUNITY_STAGE_LABELS[currentStage];

  const handleStageChange = async (newStage: OpportunityStage) => {
    if (!orgId || !projectId || !oppId || newStage === currentStage) return;

    try {
      setIsUpdating(true);
      await updateOpportunityStageApi(orgId, { projectId, oppId, stage: newStage });
      setCurrentStage(newStage);
      onStageChanged?.(newStage);
      toast({
        title: 'Stage updated',
        description: `Opportunity moved to ${OPPORTUNITY_STAGE_LABELS[newStage]}`,
      });
    } catch {
      toast({
        title: 'Error',
        description: 'Failed to update opportunity stage',
        variant: 'destructive',
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const badge = (
    <Badge
      variant="outline"
      className={cn(
        'text-xs h-5 px-1.5 font-medium border',
        colorClass,
        editable && 'cursor-pointer hover:opacity-80 transition-opacity',
        className,
      )}
    >
      {isUpdating ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <>
          {label}
          {editable && <ChevronDown className="h-2.5 w-2.5 ml-0.5 opacity-60" />}
        </>
      )}
    </Badge>
  );

  if (!editable || !orgId || !projectId || !oppId) {
    return badge;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={isUpdating}>
        {badge}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          Move to stage
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        {/* Active stages */}
        {STAGE_ORDER.filter(s => ACTIVE_OPPORTUNITY_STAGES.includes(s)).map(s => (
          <DropdownMenuItem
            key={s}
            onClick={() => handleStageChange(s)}
            className={cn(
              'text-xs cursor-pointer',
              s === currentStage && 'font-semibold',
            )}
          >
            <span className={cn(
              'inline-block w-2 h-2 rounded-full mr-2',
              s === 'IDENTIFIED' && 'bg-slate-400',
              s === 'QUALIFYING' && 'bg-blue-500',
              s === 'PURSUING' && 'bg-indigo-500',
              s === 'SUBMITTED' && 'bg-amber-500',
            )} />
            {OPPORTUNITY_STAGE_LABELS[s]}
            {s === currentStage && ' ✓'}
          </DropdownMenuItem>
        ))}

        <DropdownMenuSeparator />

        {/* Terminal stages */}
        {STAGE_ORDER.filter(s => TERMINAL_OPPORTUNITY_STAGES.includes(s)).map(s => (
          <DropdownMenuItem
            key={s}
            onClick={() => handleStageChange(s)}
            className={cn(
              'text-xs cursor-pointer',
              s === currentStage && 'font-semibold',
              (s === 'LOST' || s === 'WITHDRAWN') && 'text-muted-foreground',
            )}
          >
            <span className={cn(
              'inline-block w-2 h-2 rounded-full mr-2',
              s === 'WON' && 'bg-emerald-500',
              s === 'LOST' && 'bg-red-400',
              s === 'NO_BID' && 'bg-gray-400',
              s === 'WITHDRAWN' && 'bg-gray-300',
            )} />
            {OPPORTUNITY_STAGE_LABELS[s]}
            {s === currentStage && ' ✓'}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
