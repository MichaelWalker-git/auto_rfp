'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { AlertTriangle } from 'lucide-react';
import { ACE_STAGE_ORDER, AceStageSchema } from '@auto-rfp/core';
import type { AceStage } from '@auto-rfp/core';

interface AceStageSelectProps {
  /** Current stored ACE stage (undefined until gate-1 approve / first manual set). */
  value: AceStage | undefined;
  /** Last Partner Central sync error, shown as a warning badge. */
  syncError: string | null | undefined;
  disabled?: boolean;
  onChange: (stage: AceStage) => void;
}

/**
 * ACE (AWS Partner Central) lifecycle stage dropdown for a pipeline card. All
 * 7 stages are freely selectable; changing the value pushes the update to
 * Partner Central. A destructive badge flags a failed sync (the local value
 * still sticks).
 */
export function AceStageSelect({ value, syncError, disabled, onChange }: AceStageSelectProps) {
  const handleChange = (raw: string) => {
    const { success, data } = AceStageSchema.safeParse(raw);
    if (success) onChange(data);
  };

  return (
    <div className="flex items-center gap-1.5">
      <Select value={value} disabled={disabled} onValueChange={handleChange}>
        <SelectTrigger size="sm" className="h-7 w-full text-xs" aria-label="ACE stage">
          <SelectValue placeholder="ACE stage" />
        </SelectTrigger>
        <SelectContent>
          {ACE_STAGE_ORDER.map((stage) => (
            <SelectItem key={stage} value={stage} className="text-xs">
              {stage}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {syncError && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="destructive" className="shrink-0 gap-1 text-xs">
                <AlertTriangle className="h-3 w-3" />
                ACE
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              <p className="text-xs">Partner Central sync failed: {syncError}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </div>
  );
}
