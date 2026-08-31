import { lambdaEntry } from './route-helper';

import type { DomainRoutes } from './types';

/**
 * Solution Plan ("Source of Truth") REST API (T7).
 * The grilling worker itself is SQS-driven (see api-orchestrator-stack.ts);
 * these routes init/poll/edit the plan. SOLUTION_PLAN_QUEUE_URL is in
 * commonEnv, so no per-route env is needed.
 */
export const solutionPlanDomain = (): DomainRoutes => {
  return {
    basePath: 'solution-plan',
    routes: [
      // Start (or regenerate) the grilling run.
      {
        method: 'POST',
        path: 'init',
        entry: lambdaEntry('solution-plan/init-solution-plan.ts'),
        timeoutSeconds: 30,
      },
      // Poll the plan record (status/staleness/version).
      {
        method: 'GET',
        path: 'get',
        entry: lambdaEntry('solution-plan/get-solution-plan.ts'),
      },
      // Live grilling interview transcript.
      {
        method: 'GET',
        path: 'transcript',
        entry: lambdaEntry('solution-plan/get-transcript.ts'),
      },
      // Manual content edit (READY plans only — ADR-8).
      {
        method: 'PATCH',
        path: 'update',
        entry: lambdaEntry('solution-plan/update-solution-plan.ts'),
      },
      // Synthesized/edited HTML body from S3.
      {
        method: 'GET',
        path: 'html-content',
        entry: lambdaEntry('solution-plan/get-html-content.ts'),
      },
      // Plan team (team-definition U3) — removedEmployee derived on read.
      {
        method: 'GET',
        path: 'team',
        entry: lambdaEntry('solution-plan/get-plan-team.ts'),
      },
      // Persist a human-edited team (BR3.1 — sets userModified, survives plan regens).
      {
        method: 'PATCH',
        path: 'team/save',
        entry: lambdaEntry('solution-plan/save-plan-team.ts'),
      },
      // Explicit team regenerate (W4) — one synchronous Bedrock matching call.
      {
        method: 'POST',
        path: 'team/regenerate',
        entry: lambdaEntry('solution-plan/regenerate-plan-team.ts'),
        timeoutSeconds: 120,
        memorySize: 512,
      },
      // ── Version history (solution-plan-versioning u2, contract C1) ──
      // List a plan's versions, newest first (≤30) + currentVersionId.
      {
        method: 'GET',
        path: 'versions',
        entry: lambdaEntry('solution-plan/list-solution-plan-versions.ts'),
        logRetention: 'mandated',
      },
      // One version's HTML body at the record's own htmlContentKey.
      {
        method: 'GET',
        path: 'version/content',
        entry: lambdaEntry('solution-plan/get-solution-plan-version-content.ts'),
        logRetention: 'mandated',
      },
      // Set / rename / clear a version's label (≤100 chars; empty clears).
      {
        method: 'PATCH',
        path: 'version/label',
        entry: lambdaEntry('solution-plan/set-solution-plan-version-label.ts'),
        logRetention: 'mandated',
      },
      // Delete a non-current version (current → 409, vanished → 404).
      {
        method: 'DELETE',
        path: 'version',
        entry: lambdaEntry('solution-plan/delete-solution-plan-version.ts'),
        logRetention: 'mandated',
      },
      // Restore-as-new (u3, contract C2): fresh S3 copy → conditional plan
      // write → capture origin "restore" (current → 409, generating → 409,
      // vanished → 404).
      {
        method: 'POST',
        path: 'version/restore',
        entry: lambdaEntry('solution-plan/restore-solution-plan-version.ts'),
        logRetention: 'mandated',
      },
    ],
  };
};
