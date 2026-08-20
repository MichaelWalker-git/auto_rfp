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
    ],
  };
};
