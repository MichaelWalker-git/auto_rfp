import { Check, AlertTriangle, Circle, CircleDot, HelpCircle, type LucideIcon } from 'lucide-react';
import type { ProgressStep, StepStatus } from './types';

export interface StatusDisplay {
  /** Screen-reader / tooltip text — status conveyed in words, never colour alone (FR6). */
  label: string;
  icon: LucideIcon;
  /** Circle classes for the full/condensed node. */
  circle: string;
}

export const STATUS_DISPLAY: Record<StepStatus, StatusDisplay> = {
  'not-started': {
    label: 'not started',
    icon: Circle,
    circle: 'border-muted-foreground/30 bg-background text-muted-foreground',
  },
  'in-progress': {
    label: 'in progress',
    icon: CircleDot,
    circle: 'border-indigo-500 bg-indigo-50 text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300',
  },
  complete: {
    label: 'complete',
    icon: Check,
    circle: 'border-emerald-500 bg-emerald-500 text-white',
  },
  'needs-attention': {
    label: 'needs attention',
    icon: AlertTriangle,
    circle: 'border-amber-500 bg-amber-50 text-amber-600 dark:bg-amber-950 dark:text-amber-300',
  },
  unavailable: {
    label: 'status unavailable',
    icon: HelpCircle,
    circle: 'border-dashed border-muted-foreground/40 bg-background text-muted-foreground',
  },
};

/** Full accessible sentence for a step, e.g.
 *  "Required Forms, needs attention, 2 of 3 filled. Outdated — new solicitation uploaded." */
export const stepAccessibleLabel = (step: ProgressStep): string => {
  const status = STATUS_DISPLAY[step.status].label;
  const base = `${step.label}, ${status}, ${step.detailText}`;
  return step.reason ? `${base}. ${step.reason}` : base;
};

/** The current step = first non-complete step, or the last step when all complete. */
export const currentStepIndex = (steps: ProgressStep[]): number => {
  const idx = steps.findIndex((s) => s.status !== 'complete');
  if (idx === -1) return Math.max(0, steps.length - 1);
  return idx;
};

/** Count of complete steps (the "K" in "K of N"). */
export const completeCount = (steps: ProgressStep[]): number =>
  steps.filter((s) => s.status === 'complete').length;
