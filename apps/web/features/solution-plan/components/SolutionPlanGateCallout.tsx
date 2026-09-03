'use client';

import Link from 'next/link';
import { AlertTriangle, Lightbulb } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

/** Tooltip / short label for controls disabled by the generation gate. */
export const SOLUTION_PLAN_GATE_BLOCKED_LABEL = 'Create a Solution Plan first';

export const buildSolutionPlanSectionHref = (
  orgId: string,
  projectId: string,
  opportunityId: string,
): string =>
  `/organizations/${orgId}/projects/${projectId}/opportunities/${opportunityId}?tab=solution-plan`;

interface SolutionPlanGateCalloutProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
  /** Invoked when the link is followed (e.g. to close a containing dialog). */
  onNavigate?: () => void;
}

/**
 * Inline callout shown at generation entry points while the Solution Plan
 * gate is active (T12), linking to the opportunity page's plan section.
 */
export const SolutionPlanGateCallout = ({
  orgId,
  projectId,
  opportunityId,
  onNavigate,
}: SolutionPlanGateCalloutProps) => (
  <Alert data-testid="solution-plan-gate-callout">
    <AlertTriangle className="h-4 w-4" />
    <AlertDescription>
      {SOLUTION_PLAN_GATE_BLOCKED_LABEL} — proposal documents are generated from it.{' '}
      <Link
        href={buildSolutionPlanSectionHref(orgId, projectId, opportunityId)}
        className="font-medium underline underline-offset-2"
        onClick={onNavigate}
      >
        Go to Solution Plan
      </Link>
    </AlertDescription>
  </Alert>
);

/**
 * Non-blocking nudge shown when generation is allowed only because the
 * opportunity is grandfathered by existing documents (ADR-10): recommend
 * creating a plan without gating anything.
 */
export const SolutionPlanNudgeBanner = ({
  orgId,
  projectId,
  opportunityId,
  onNavigate,
}: SolutionPlanGateCalloutProps) => (
  <Alert data-testid="solution-plan-nudge-banner">
    <Lightbulb className="h-4 w-4" />
    <AlertDescription>
      Solution Plan recommended — this opportunity predates Solution Plans, so
      generation still works, but a plan gives the AI an approved source of truth.{' '}
      <Link
        href={buildSolutionPlanSectionHref(orgId, projectId, opportunityId)}
        className="font-medium underline underline-offset-2"
        onClick={onNavigate}
      >
        Create a Solution Plan
      </Link>
    </AlertDescription>
  </Alert>
);
