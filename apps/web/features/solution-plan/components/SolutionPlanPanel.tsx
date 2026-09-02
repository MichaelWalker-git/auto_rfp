'use client';

import Link from 'next/link';
import { AlertTriangle, FileEdit, Play, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import PermissionWrapper from '@/components/permission-wrapper';
import { useSolutionPlan } from '../hooks/useSolutionPlan';
import { useGrillingTranscript } from '../hooks/useGrillingTranscript';
import { useSolutionPlanActions } from '../hooks/useSolutionPlanActions';
import { GrillingTranscriptView } from './GrillingTranscriptView';
import { SolutionPlanStatusBadge } from './SolutionPlanStatusBadge';
import { TeamDefinitionSection } from './TeamDefinitionSection';
import { VersionHistoryControl } from './VersionHistoryControl';

interface SolutionPlanPanelProps {
  orgId: string;
  projectId: string;
  opportunityId: string;
}

/**
 * Opportunity-page section for the Solution Plan ("Source of Truth"):
 * shows the plan status, the live grilling transcript while a run is in
 * flight, and the Start / View & Edit / Regenerate / Retry actions.
 */
export const SolutionPlanPanel = ({ orgId, projectId, opportunityId }: SolutionPlanPanelProps) => {
  const { plan, isRunning, isLoading, notFound, refresh } = useSolutionPlan(
    orgId,
    projectId,
    opportunityId,
  );
  const { messages, isLoading: isTranscriptLoading } = useGrillingTranscript(
    orgId,
    projectId,
    opportunityId,
    { enabled: isRunning },
  );
  const { startRun, regenerate, isInitializing, ConfirmDialog } = useSolutionPlanActions(
    orgId,
    projectId,
    opportunityId,
    { plan, refresh },
  );

  const editHref = `/organizations/${orgId}/projects/${projectId}/opportunities/${opportunityId}/solution-plan/edit`;

  const handleStart = () => void startRun();
  const handleRegenerate = () => void regenerate();

  const renderBody = () => {
    if (isLoading && !plan && !notFound) {
      return (
        <div className="space-y-3" data-testid="solution-plan-skeleton">
          <Skeleton className="h-8 w-1/3" />
          <Skeleton className="h-20 w-full" />
        </div>
      );
    }

    if (!plan) {
      return (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            No Solution Plan yet. Start one to have AI interview your knowledge base and produce
            the approved plan that document generation builds on.
          </p>
          <PermissionWrapper requiredPermission="proposal:create">
            <Button onClick={handleStart} disabled={isInitializing}>
              <Play className="mr-1.5 h-4 w-4" />
              Start Solution Plan
            </Button>
          </PermissionWrapper>
        </div>
      );
    }

    if (isRunning) {
      return (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {plan.status === 'GRILLING'
              ? 'The AI interview is running — questions and answers appear live below.'
              : 'Interview complete — synthesizing the Solution Plan…'}
          </p>
          <GrillingTranscriptView messages={messages} isLoading={isTranscriptLoading} />
          {plan.status === 'GENERATING_SOT' && (
            <Skeleton className="h-10 w-full" data-testid="synthesis-skeleton" />
          )}
        </div>
      );
    }

    if (plan.status === 'FAILED') {
      return (
        <div className="space-y-4">
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Solution Plan generation failed{plan.error ? `: ${plan.error}` : '.'}
            </AlertDescription>
          </Alert>
          <PermissionWrapper requiredPermission="proposal:create">
            <Button onClick={handleStart} disabled={isInitializing}>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Retry
            </Button>
          </PermissionWrapper>
        </div>
      );
    }

    // READY — possibly stale and/or user-edited.
    return (
      <div className="space-y-4">
        {plan.isStale && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Solution Plan may be outdated — regenerate recommended.
              {plan.staleReason ? ` ${plan.staleReason}` : ''}
            </AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* The version dropdown replaces the static "Version {n}" text (U4). */}
            <VersionHistoryControl
              orgId={orgId}
              projectId={projectId}
              opportunityId={opportunityId}
              isPlanRunning={isRunning}
              onPlanRestored={refresh}
            />
            <p className="text-sm text-muted-foreground">
              {plan.isUserEdited ? 'Manually edited — used' : 'Used'} as the source of truth for
              generated documents.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={editHref}>
                <FileEdit className="mr-1.5 h-4 w-4" />
                View &amp; Edit
              </Link>
            </Button>
            <PermissionWrapper requiredPermission="proposal:create">
              <Button variant="outline" onClick={handleRegenerate} disabled={isInitializing}>
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Regenerate
              </Button>
            </PermissionWrapper>
          </div>
        </div>
        {/* Team Definition (U3) — the recommended team lives INSIDE the plan. */}
        <TeamDefinitionSection
          orgId={orgId}
          projectId={projectId}
          opportunityId={opportunityId}
        />
      </div>
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Solution Plan</CardTitle>
          {plan && <SolutionPlanStatusBadge status={plan.status} />}
        </div>
        <CardDescription>
          The approved technical and delivery plan for this opportunity — the source of truth
          that proposal documents are generated from.
        </CardDescription>
      </CardHeader>
      <CardContent>{renderBody()}</CardContent>
      <ConfirmDialog />
    </Card>
  );
};
