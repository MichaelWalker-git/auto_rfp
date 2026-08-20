'use client';

import { useConfirmDialog } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/use-toast';
import type { ApiError } from '@/lib/hooks/api-helpers';
import type { SolutionPlanItem } from '@auto-rfp/core';
import { useInitSolutionPlan } from './useInitSolutionPlan';

interface UseSolutionPlanActionsOptions {
  plan: SolutionPlanItem | null;
  /** Revalidates the plan record after a successful init. */
  refresh: () => Promise<unknown>;
}

/**
 * Start / Retry / Regenerate flows for the Solution Plan panel:
 * the 409 restart-confirm loop when a run is already in flight (ADR-5) and
 * the regenerate confirm that warns manual edits are permanently lost when
 * the plan has been hand-edited (ADR-4).
 */
export const useSolutionPlanActions = (
  orgId: string,
  projectId: string,
  opportunityId: string,
  { plan, refresh }: UseSolutionPlanActionsOptions,
) => {
  const { initSolutionPlan, isInitializing } = useInitSolutionPlan(
    orgId,
    projectId,
    opportunityId,
  );
  const { confirm, ConfirmDialog } = useConfirmDialog();
  const { toast } = useToast();

  const startRun = async (restart?: boolean): Promise<void> => {
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
  const regenerate = async (): Promise<void> => {
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

  return { startRun, regenerate, isInitializing, ConfirmDialog };
};
