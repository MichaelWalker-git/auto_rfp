'use client';

import * as React from 'react';
import { ChevronLeft, ChevronRight, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { STATUS_DISPLAY } from '../lib/status-display';
import { StepDetailsContent } from './StepDetailsContent';
import type { NavigationDescriptor, ProgressStep, StepStatus } from '../lib/types';

const NAV_LABEL = 'Opportunity tabs';

/** One tab in the strip. Step-backed tabs carry a `ProgressStep` (metric + status
 *  icon + `StepDetailsContent` popover); the Outcome and Related tabs instead
 *  supply their own `metricText` + `popover` body. */
export interface TabHeaderModel {
  key: string;
  label: string;
  navigation: NavigationDescriptor;
  /** Present for the seven step-backed tabs. */
  step?: ProgressStep;
  /** Metric text for non-step tabs (Outcome label, "N related"). */
  metricText?: string;
  /** Popover body for non-step tabs. */
  popover?: React.ReactNode;
}

export interface ProgressTabStripProps {
  tabs: TabHeaderModel[];
  activeKey: string;
  onNavigate: (nav: NavigationDescriptor) => void;
  isLoading?: boolean;
}

// ─── Status circle (step-backed tabs only) ──────────────────────────────────────

const StepCircle = ({ status }: { status: StepStatus }) => {
  const { icon: Icon, circle } = STATUS_DISPLAY[status];
  return (
    <span
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
        circle,
      )}
      aria-hidden
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  );
};

// ─── Details popover ─────────────────────────────────────────────────────────

const TabDetails = ({ tab }: { tab: TabHeaderModel }) => (
  <Popover>
    <PopoverTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-auto w-auto rounded-full p-0.5 text-muted-foreground/70 hover:text-foreground"
        aria-label={`Details for ${tab.label}`}
      >
        <Info className="h-3.5 w-3.5" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-72">
      {tab.step ? <StepDetailsContent step={tab.step} /> : tab.popover}
    </PopoverContent>
  </Popover>
);

// ─── Scroll-edge affordance ─────────────────────────────────────────────────────

/**
 * A fade + chevron pinned to one edge of the scrollable strip, shown only when
 * there is more to scroll that way. Clicking nudges the row by most of a page.
 * The gradient is click-through (`pointer-events-none`) so it never eats a tab
 * click; only the small chevron button is interactive.
 */
const ScrollEdge = ({
  side,
  onClick,
}: {
  side: 'left' | 'right';
  onClick: () => void;
}) => {
  const isLeft = side === 'left';
  const Icon = isLeft ? ChevronLeft : ChevronRight;
  return (
    <>
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-y-0 z-10 w-10 from-background to-transparent',
          isLeft ? 'left-0 bg-gradient-to-r' : 'right-0 bg-gradient-to-l',
        )}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onClick}
        aria-label={isLeft ? 'Scroll tabs left' : 'Scroll tabs right'}
        tabIndex={-1}
        className={cn(
          'absolute top-1/2 z-20 h-6 w-6 -translate-y-1/2 rounded-full border bg-background/90 text-muted-foreground shadow-sm hover:text-foreground',
          isLeft ? 'left-0.5' : 'right-0.5',
        )}
      >
        <Icon className="h-4 w-4" />
      </Button>
    </>
  );
};

// ─── Skeleton ────────────────────────────────────────────────────────────────

const StripSkeleton = () => (
  <div
    role="tablist"
    aria-label={NAV_LABEL}
    aria-busy="true"
    className="flex items-stretch gap-1 border-b"
  >
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="flex flex-1 items-center justify-center gap-2 px-2 py-2">
        <Skeleton className="h-6 w-6 rounded-full" />
        <div className="space-y-1">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-2.5 w-14" />
        </div>
      </div>
    ))}
  </div>
);

// ─── Strip ─────────────────────────────────────────────────────────────────────

/**
 * The opportunity tab strip (ADR 0001). A single horizontally-scrollable row of
 * tab headers; each header doubles as a progress indicator — name + completeness
 * metric + status icon + a "more details" popover. Pure presentation: the active
 * tab and navigation are driven by the parent (which owns the `?tab=` state).
 */
export const ProgressTabStrip = ({
  tabs,
  activeKey,
  onNavigate,
  isLoading = false,
}: ProgressTabStripProps) => {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = React.useState(false);
  const [canScrollRight, setCanScrollRight] = React.useState(false);

  const updateEdges = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    // 1px slack absorbs sub-pixel rounding at the extremes.
    setCanScrollLeft(el.scrollLeft > 1);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }, []);

  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateEdges();
    el.addEventListener('scroll', updateEdges, { passive: true });
    const observer = new ResizeObserver(updateEdges);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', updateEdges);
      observer.disconnect();
    };
    // Re-measure when the tab set changes (tabs appear/disappear on gating).
  }, [updateEdges, tabs.length]);

  const nudge = React.useCallback((direction: -1 | 1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * el.clientWidth * 0.7, behavior: 'smooth' });
  }, []);

  if (isLoading) return <StripSkeleton />;

  return (
    <div className="relative">
      {canScrollLeft && <ScrollEdge side="left" onClick={() => nudge(-1)} />}
      {canScrollRight && <ScrollEdge side="right" onClick={() => nudge(1)} />}
      <div
        ref={scrollRef}
        role="tablist"
        aria-label={NAV_LABEL}
        className="flex items-stretch gap-1 overflow-x-auto border-b"
      >
        {tabs.map((tab) => {
        const isActive = tab.key === activeKey;
        const metricText = tab.step ? tab.step.detailText : tab.metricText;
        // Accessible name always leads with the visible tab label (not the step
        // label — Details is backed by the "Solicitations" step), then the status
        // and metric so the header is understandable without opening the popover.
        const statusText = tab.step ? STATUS_DISPLAY[tab.step.status].label : undefined;
        const accessibleName = [tab.label, statusText, metricText]
          .filter(Boolean)
          .join(', ');
        return (
          // Each tab grows to share the row width (flex-1) so the headers span the
          // full width on wide screens instead of clustering left — but never
          // shrinks below its own content (`min-w-max`), so the label and info icon
          // can't be squashed together: once the tabs stop fitting, the row scrolls
          // instead. The active highlight — a filled background plus a bottom accent
          // border — lives on this wrapper so it also encloses the info icon.
          <div
            key={tab.key}
            className={cn(
              'flex min-w-max flex-1 items-center justify-center gap-1 rounded-t-md border-b-2 px-1.5 py-1.5 transition-colors',
              isActive
                ? 'border-primary bg-muted'
                : 'border-transparent hover:bg-muted/50',
            )}
          >
            <button
              type="button"
              role="tab"
              id={`tab-${tab.key}`}
              aria-selected={isActive}
              aria-controls={`tabpanel-${tab.key}`}
              aria-label={accessibleName}
              onClick={() => onNavigate(tab.navigation)}
              className={cn(
                'flex items-center gap-2 rounded-md px-1 py-0.5 text-left transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                isActive ? 'font-semibold text-foreground' : 'text-muted-foreground',
              )}
            >
              {tab.step && <StepCircle status={tab.step.status} />}
              <span className="flex flex-col">
                <span className="whitespace-nowrap text-sm">{tab.label}</span>
                {metricText && (
                  <span className="whitespace-nowrap text-xs text-muted-foreground">
                    {metricText}
                  </span>
                )}
              </span>
            </button>
            <span className="shrink-0">
              <TabDetails tab={tab} />
            </span>
          </div>
        );
        })}
      </div>
    </div>
  );
};
