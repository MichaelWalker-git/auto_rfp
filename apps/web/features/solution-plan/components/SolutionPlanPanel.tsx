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
import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/use-toast';
import PermissionWrapper from '@/components/permission-wrapper';
import type { ApiError } from '@/lib/hooks/api-helpers';
import { useSolutionPlan } from '../hooks/useSolutionPlan';
import { useGrillingTranscript } from '../hooks/useGrillingTranscript';
import { useInitSolutionPlan } from '../hooks/useInitSolutionPlan';
import { GrillingTranscriptView } from './GrillingTranscriptView';
import { SolutionPlanStatusBadge } from './SolutionPlanStatusBadge';

interface SolutionPlanPanelProps {
  orgId: string;
  projectId: string;
  oppId: string;
}

/**
 * Opportunity-page section for the Solution Plan ("Source of Truth"):
 * shows the plan status, the live grilling transcript while a run is in
 * flight, and the Start / View & Edit / Regenerate / Retry actions.
 */
export const SolutionPlanPanel = ({ orgId, projectId, oppId }: SolutionPlanPanelProps) => {
  const { plan, isRunning, isLoading, notFound, refresh } = useSolutionPlan(
    orgId,
    projectId,
    oppId,
  );
  const { messages, isLoading: isTranscriptLoading } = useGrillingTranscript(
    orgId,
    projectId,
    oppId,
    { enabled: isRunning },
  );
  const { initSolutionPlan, isInitializing } = useInitSolutionPlan(orgId, projectId, oppId);
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const { toast } = useToast();

  const editHref = `/organizations/${orgId}/projects/${projectId}/opportunities/${oppId}/solution-plan/edit`;

  const startRun = async (restart?: boolean) => {
    try {
      await initSolutionPlan(restart ? { restart: true } : undefined);
      await refresh();
    } catch (err) {
      const apiError = err as ApiError;
      if (apiError.status === 409) {
        const restartConfirmed = await confirm({
          title: 'A run is already in progress',
          description:
            'A Solution Plan run is already in progress for this opportunity. Abandon it and start over?',
          confirmLabel: 'Restart run',
          variant: 'destructive',
        });
        if (restartConfirmed) await startRun(true);
        return;
      }
      toast({
        title: 'Could not start the Solution Plan',
        description: apiError.message,
        variant: 'destructive',
      });
    }
  };

  // ADR-4: regenerating wipes the previous run — when the plan has manual
  // edits the confirm dialog must say they are permanently lost.
  const handleRegenerate = async () => {
    const confirmed = await confirm({
      title: 'Regenerate Solution Plan?',
      description: plan?.isUserEdited
        ? 'This plan contains manual edits. Regenerating runs a new interview and your manual edits will be permanently lost.'
        : 'This runs a new interview and replaces the current plan.',
      confirmLabel: 'Regenerate',
      variant: plan?.isUserEdited ? 'destructive' : 'default',
    });
    if (confirmed) await startRun();
  };

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
            <Button onClick={() => void startRun()} disabled={isInitializing}>
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
            <Button onClick={() => void startRun()} disabled={isInitializing}>
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
          <p className="text-sm text-muted-foreground">
            Version {plan.version}
            {plan.isUserEdited ? ' · manually edited' : ''} — used as the source of truth for
            generated documents.
          </p>
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={editHref}>
                <FileEdit className="mr-1.5 h-4 w-4" />
                View &amp; Edit
              </Link>
            </Button>
            <PermissionWrapper requiredPermission="proposal:create">
              <Button
                variant="outline"
                onClick={() => void handleRegenerate()}
                disabled={isInitializing}
              >
                <RefreshCw className="mr-1.5 h-4 w-4" />
                Regenerate
              </Button>
            </PermissionWrapper>
          </div>
        </div>
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
