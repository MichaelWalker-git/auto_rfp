/**
 * solution-plan-init.ts
 *
 * Orchestration for starting (or regenerating) a Solution Plan grilling run:
 * upsert the plan record with status GRILLING and a fresh runId, wipe the old
 * transcript, and enqueue round 1. One plan id per opportunity, forever
 * (ADR-2); `version` survives regeneration (ADR-11).
 *
 * Kept out of `solution-plan.ts` on purpose: this module pulls in the SQS
 * enqueue helper, whose SOLUTION_PLAN_QUEUE_URL env requirement must not leak
 * to every consumer of the plain DB/S3 helpers.
 */

import { v4 as uuidv4 } from 'uuid';
import { ulid } from 'ulid';

import type { SolutionPlanItem, SolutionPlanKey, SolutionPlanStatus } from '@auto-rfp/core';

import { nowIso } from './date';
import {
  deleteGrillingMessages,
  getSolutionPlanByOpportunity,
  putSolutionPlan,
} from './solution-plan';
import { enqueueGrillingRound } from './solution-plan-queue';
import { isExtractedQuestionFile, listQuestionFilesByOpportunity } from './questionFile';

export type InitSolutionPlanRunResult =
  | { outcome: 'NO_PROCESSED_FILES' }
  | { outcome: 'RUN_IN_PROGRESS'; solutionPlanStatus: SolutionPlanStatus }
  | { outcome: 'STARTED'; plan: SolutionPlanItem; regenerated: boolean; wipedMessages: number };

/**
 * Re-init while a run is in flight (GRILLING/GENERATING_SOT) requires an
 * explicit `restart: true` — a silent re-init is refused (ADR-5).
 */
export const initSolutionPlanRun = async (
  key: SolutionPlanKey,
  opts: { restart?: boolean; userId?: string },
): Promise<InitSolutionPlanRunResult> => {
  const { orgId, projectId, opportunityId } = key;

  // The grilling loop interviews against the solicitation text — fail fast
  // when nothing has finished extraction yet.
  const { items: questionFiles } = await listQuestionFilesByOpportunity({
    projectId,
    oppId: opportunityId,
  });
  const hasProcessedFiles = questionFiles.some(
    (qf) => qf.textFileKey && isExtractedQuestionFile(qf.status),
  );
  if (!hasProcessedFiles) {
    return { outcome: 'NO_PROCESSED_FILES' };
  }

  const existing = await getSolutionPlanByOpportunity(key);
  if (
    existing &&
    (existing.status === 'GRILLING' || existing.status === 'GENERATING_SOT') &&
    !opts.restart
  ) {
    return { outcome: 'RUN_IN_PROGRESS', solutionPlanStatus: existing.status };
  }

  const runId = ulid();
  const now = nowIso();

  // Full overwrite: run-scoped fields (contentKey, error, grilling markers,
  // user-edit markers) reset; identity + monotonic version are preserved.
  const plan: SolutionPlanItem = {
    id: existing?.id ?? uuidv4(),
    orgId,
    projectId,
    opportunityId,
    status: 'GRILLING',
    isStale: false,
    runId,
    version: existing?.version ?? 0,
    isUserEdited: false,
    grillingRounds: 0,
    createdAt: existing?.createdAt ?? now,
    createdBy: existing?.createdBy ?? opts.userId,
    updatedBy: opts.userId,
  };

  // Stamp the fresh runId first so in-flight workers of a previous run start
  // no-oping (ADR-5), then wipe the transcript, then kick off round 1.
  await putSolutionPlan(plan);
  const wipedMessages = await deleteGrillingMessages(plan.id);
  await enqueueGrillingRound({
    orgId,
    projectId,
    opportunityId,
    solutionPlanId: plan.id,
    runId,
    round: 1,
    phase: 'GRILL',
  });

  return { outcome: 'STARTED', plan, regenerated: !!existing, wipedMessages };
};
