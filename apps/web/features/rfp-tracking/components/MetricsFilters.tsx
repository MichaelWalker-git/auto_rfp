'use client';

import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { OwnerOption } from '../lib/derive-metrics';

export const WEEK_PRESETS = [
  { label: 'Last 4 weeks', weeks: 4 },
  { label: 'Last 8 weeks', weeks: 8 },
  { label: 'Last 12 weeks', weeks: 12 },
  { label: 'Last 26 weeks', weeks: 26 },
] as const;

const ALL_OWNERS = '__all__';

interface MetricsFiltersProps {
  /** Currently selected preset (number of weeks). */
  weeks: number;
  onWeeksChange: (weeks: number) => void;
  /** Selected owner assigneeId, or undefined for all owners. */
  assigneeId?: string;
  onAssigneeChange: (assigneeId: string | undefined) => void;
  owners: OwnerOption[];
}

/**
 * Metrics tab filter bar: a date-range preset (default "Last 8 weeks") plus an
 * owner selector. Pure presentation — state lives in the parent MetricsView.
 */
export const MetricsFilters = ({
  weeks,
  onWeeksChange,
  assigneeId,
  onAssigneeChange,
  owners,
}: MetricsFiltersProps) => (
  <div className="flex flex-wrap items-center gap-2">
    <div className="flex gap-1">
      {WEEK_PRESETS.map((preset) => (
        <Button
          key={preset.weeks}
          variant={preset.weeks === weeks ? 'default' : 'outline'}
          size="sm"
          className="h-8 text-xs"
          onClick={() => onWeeksChange(preset.weeks)}
        >
          {preset.label}
        </Button>
      ))}
    </div>

    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground">Owner</span>
      <Select
        value={assigneeId ?? ALL_OWNERS}
        onValueChange={(value) => onAssigneeChange(value === ALL_OWNERS ? undefined : value)}
      >
        <SelectTrigger className="h-8 w-44 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_OWNERS} className="text-xs">
            All owners
          </SelectItem>
          {owners.map((owner) => (
            <SelectItem key={owner.assigneeId} value={owner.assigneeId} className="text-xs">
              {owner.assigneeName}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  </div>
);
