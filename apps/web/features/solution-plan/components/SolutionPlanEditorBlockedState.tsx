'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowLeft, FileText } from 'lucide-react';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { SolutionPlanItem } from '@auto-rfp/core';
import { SolutionPlanStatusBadge } from './SolutionPlanStatusBadge';

interface SolutionPlanEditorBlockedStateProps {
  plan: SolutionPlanItem | null;
  /** A grilling run is in flight (GRILLING / GENERATING_SOT). */
  isRunning: boolean;
  /** The org-level `enableSolutionPlan` flag (R2 ships behind it). */
  isFeatureEnabled: boolean;
  backUrl: string;
}

/**
 * Centered full-page state for every situation where the editor cannot be
 * shown — feature flag off, no plan yet, run in flight, or generation
 * failed — with a way back to the opportunity.
 */
export const SolutionPlanEditorBlockedState = ({
  plan,
  isRunning,
  isFeatureEnabled,
  backUrl,
}: SolutionPlanEditorBlockedStateProps) => (
  <div className="flex flex-col items-center justify-center py-24 gap-4">
    {!isFeatureEnabled ? (
      <>
        <FileText className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">
          Solution Plan is not enabled for this organization.
        </p>
      </>
    ) : !plan ? (
      <>
        <FileText className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">
          No Solution Plan exists for this opportunity yet.
        </p>
      </>
    ) : isRunning ? (
      <>
        <SolutionPlanStatusBadge status={plan.status} />
        <p className="text-sm text-muted-foreground max-w-md text-center">
          {plan.status === 'GRILLING'
            ? 'The AI interview is running — follow it live on the opportunity page. The plan becomes editable once it is ready.'
            : 'The Solution Plan is being synthesized. It becomes editable once it is ready.'}
        </p>
      </>
    ) : (
      <Alert variant="destructive" className="max-w-md">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Solution Plan generation failed{plan.error ? `: ${plan.error}` : '.'}
        </AlertDescription>
      </Alert>
    )}
    <Button variant="outline" asChild>
      <Link href={backUrl}>
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to Opportunity
      </Link>
    </Button>
  </div>
);
