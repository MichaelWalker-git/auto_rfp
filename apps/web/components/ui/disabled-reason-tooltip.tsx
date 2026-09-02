'use client';

import React from 'react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface DisabledReasonTooltipProps {
  /** When set, the children are wrapped in a tooltip showing this reason. */
  reason?: string | null;
  children: React.ReactNode;
}

/**
 * Wraps a disabled button in a tooltip explaining why it is disabled.
 * Needed because Shadcn's disabled buttons have `pointer-events: none`,
 * so the tooltip must be attached to a wrapping <span>.
 */
export const DisabledReasonTooltip = ({ reason, children }: DisabledReasonTooltipProps) => {
  if (!reason) return <>{children}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="max-w-xs">{reason}</p>
      </TooltipContent>
    </Tooltip>
  );
};
