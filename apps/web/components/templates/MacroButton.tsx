'use client';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface MacroButtonProps {
  macroKey: string;
  label: string;
  tooltip: string;
  onClick: (key: string) => void;
  disabled?: boolean;
  special?: boolean;
}

export const MacroButton = ({
  macroKey,
  label,
  tooltip,
  onClick,
  disabled,
  special,
}: MacroButtonProps) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => onClick(macroKey)}
          disabled={disabled}
          className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-mono font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
            special
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300'
              : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100 hover:border-indigo-300'
          }`}
          title={tooltip}
        >
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <p className="text-xs">{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
};
