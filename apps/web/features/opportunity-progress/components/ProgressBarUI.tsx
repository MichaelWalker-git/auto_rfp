'use client';

import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { STATUS_DISPLAY, stepAccessibleLabel, currentStepIndex, completeCount } from '../lib/status-display';
import { StepDetailsContent } from './StepDetailsContent';
import type { NavigationDescriptor, ProgressStep, StepStatus } from '../lib/types';

const NAV_LABEL = 'Package preparation progress';

export interface ProgressBarUIProps {
  steps: ProgressStep[];
  isLoading?: boolean;
  variant?: 'full' | 'condensed' | 'mobile';
  onNavigate: (nav: NavigationDescriptor) => void;
}

// ─── Status circle ──────────────────────────────────────────────────────────────

const StepCircle = ({ status, size = 'md' }: { status: StepStatus; size?: 'sm' | 'md' }) => {
  const { icon: Icon, circle } = STATUS_DISPLAY[status];
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full border',
        size === 'md' ? 'h-8 w-8' : 'h-6 w-6',
        circle,
      )}
      aria-hidden
    >
      <Icon className={size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
    </span>
  );
};

// ─── Details popover (ticket 08) ──────────────────────────────────────────────

const StepDetails = ({ step }: { step: ProgressStep }) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        // Secondary affordance — does not navigate; opens the per-item details.
        className="h-auto w-auto rounded-full p-0.5 text-muted-foreground/70 hover:text-foreground"
        aria-label={`Details for ${step.label}`}
      >
        <Info className="h-3.5 w-3.5" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-72">
      <StepDetailsContent step={step} />
    </PopoverContent>
  </Popover>
);

// ─── Skeleton (never a spinner) ──────────────────────────────────────────────

const ProgressSkeleton = () => (
  <nav aria-label={NAV_LABEL} aria-busy="true" className="flex flex-wrap items-center gap-4 py-2">
    {Array.from({ length: 7 }).map((_, i) => (
      <div key={i} className="flex items-center gap-2">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="space-y-1">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-2.5 w-14" />
        </div>
      </div>
    ))}
  </nav>
);

// ─── Full variant ────────────────────────────────────────────────────────────

const FullBar = ({
  steps,
  onNavigate,
  dense = false,
}: {
  steps: ProgressStep[];
  onNavigate: ProgressBarUIProps['onNavigate'];
  /** Pinned/scrolled state — same layout, just tighter vertical rhythm. */
  dense?: boolean;
}) => (
  <nav
    aria-label={NAV_LABEL}
    className={cn('flex flex-wrap items-stretch', dense ? 'gap-y-1 py-1' : 'gap-y-3 py-2')}
  >
    {steps.map((step, i) => (
      <div key={step.stepId} className="flex items-center">
        {i > 0 && (
          <span
            aria-hidden
            className={cn(
              'mx-2 hidden h-px w-6 sm:block',
              steps[i - 1].status === 'complete'
                ? 'border-t border-solid border-emerald-500'
                : 'border-t border-dashed border-muted-foreground/40',
            )}
          />
        )}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onNavigate(step.navigation)}
            aria-label={stepAccessibleLabel(step)}
            className="h-auto justify-start gap-2 p-1 text-left"
          >
            <StepCircle status={step.status} />
            <span className="flex min-w-0 flex-col">
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="max-w-[9rem] truncate text-sm font-medium text-foreground">
                    {step.label}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{step.label}</TooltipContent>
              </Tooltip>
              <span className="text-xs text-muted-foreground">{step.detailText}</span>
            </span>
          </Button>
          <StepDetails step={step} />
        </div>
      </div>
    ))}
  </nav>
);

// ─── Mobile variant ────────────────────────────────────────────────────────────

const MobileBar = ({ steps, onNavigate }: { steps: ProgressStep[]; onNavigate: ProgressBarUIProps['onNavigate'] }) => {
  const current = steps[currentStepIndex(steps)];
  const done = completeCount(steps);
  return (
    <nav aria-label={NAV_LABEL} className="flex flex-col gap-2 py-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">Progress</span>
        <span className="text-xs text-muted-foreground">
          {done} of {steps.length}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {steps.map((step) => (
          <Button
            key={step.stepId}
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onNavigate(step.navigation)}
            aria-label={stepAccessibleLabel(step)}
            // ≥44px touch target (FR: mobile tap reliability).
            className="h-11 w-11 rounded-full"
          >
            <StepCircle status={step.status} size="sm" />
          </Button>
        ))}
      </div>
      {current && (
        <span className="truncate text-sm">
          <span className="text-muted-foreground">Next: </span>
          <span className="font-medium text-foreground">{current.label}</span>
          <span className="text-muted-foreground"> — {current.detailText}</span>
        </span>
      )}
    </nav>
  );
};

// ─── Empty state ──────────────────────────────────────────────────────────────

const EmptyBar = () => (
  <nav aria-label={NAV_LABEL} className="py-2 text-sm text-muted-foreground">
    No steps to show yet.
  </nav>
);

// ─── ProgressBarUI ────────────────────────────────────────────────────────────

/** Pure presentation for the opportunity progress bar (ADR-005). No data fetching,
 *  no business logic — renders a fixed `ProgressStep[]` in the requested variant. */
export const ProgressBarUI = ({ steps, isLoading = false, variant = 'full', onNavigate }: ProgressBarUIProps) => {
  if (isLoading) return <ProgressSkeleton />;
  if (steps.length === 0) return <EmptyBar />;
  if (variant === 'mobile') return <MobileBar steps={steps} onNavigate={onNavigate} />;
  // Condensed = the full bar with tighter vertical padding (same layout, no icon-only collapse).
  return <FullBar steps={steps} onNavigate={onNavigate} dense={variant === 'condensed'} />;
};
