'use client';

import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { formatMonth } from '@auto-rfp/core';

interface DateRangeFilterProps {
  startMonth: string;
  endMonth: string;
  onStartMonthChange: (month: string) => void;
  onEndMonthChange: (month: string) => void;
}

const PRESET_RANGES = [
  { label: 'Last 3 months', months: 3 },
  { label: 'Last 6 months', months: 6 },
  { label: 'Last 12 months', months: 12 },
  { label: 'Last 24 months', months: 24 },
];

const generateMonthOptions = () => {
  const options: { value: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < 36; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = formatMonth(date);
    const label = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    options.push({ value, label });
  }
  return options;
};

const monthOptions = generateMonthOptions();

export const DateRangeFilter = ({
  startMonth,
  endMonth,
  onStartMonthChange,
  onEndMonthChange,
}: DateRangeFilterProps) => {
  const applyPreset = (months: number) => {
    const now = new Date();
    const end = formatMonth(now);
    const start = formatMonth(new Date(now.getFullYear(), now.getMonth() - (months - 1), 1));
    onStartMonthChange(start);
    onEndMonthChange(end);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Preset buttons */}
      <div className="flex gap-1">
        {PRESET_RANGES.map((preset) => (
          <Button
            key={preset.months}
            variant="outline"
            size="sm"
            className="text-xs h-8"
            onClick={() => applyPreset(preset.months)}
          >
            {preset.label}
          </Button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">From</span>
        <Select value={startMonth} onValueChange={onStartMonthChange}>
          <SelectTrigger className="h-8 text-xs w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <span className="text-xs text-muted-foreground">To</span>
        <Select value={endMonth} onValueChange={onEndMonthChange}>
          <SelectTrigger className="h-8 text-xs w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {monthOptions.map((opt) => (
              <SelectItem key={opt.value} value={opt.value} className="text-xs">
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
