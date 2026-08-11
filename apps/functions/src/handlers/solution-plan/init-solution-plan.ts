/**
 * POST /solution-plan/init
 *
 * Start (or regenerate) the Solution Plan grilling run for an opportunity:
 * upsert the plan record with status GRILLING and a fresh runId, wipe the old
 * transcript, and enqueue round 1. One plan id per opportunity, forever
 * (ADR-2); `version` survives regeneration (ADR-11).
 *
 * Re-init while a run is in flight (GRILLING/GENERATING_SOT) requires an
 * explicit `restart: true` — a silent re-init is refused with 409 (ADR-5).
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';

import { SolutionPlanInitRequestSchema, type SolutionPlanItem } from '@auto-rfp/core';

import { apiResponse, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { nowIso } from '@/helpers/date';
import {
  deleteGrillingMessages,
  getSolutionPlanByOpportunity,
  putSolutionPlan,
} from '@/helpers/solution-plan';
import { enqueueGrillingRound } from '@/helpers/solution-plan-queue';
import { isExtractedQuestionFile, listQuestionFilesByOpportunity } from '@/helpers/questionFile';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

export const initSolutionPlan = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const bodyJson = event.body ? JSON.parse(event.body) : {};
  const { success, data, error } = SolutionPlanInitRequestSchema.safeParse(bodyJson);
  if (!success) {
    return apiResponse(400, { message: 'Validation failed', issues: error.issues });
  }

  const { orgId, projectId, opportunityId, restart } = data;
  const key = { orgId, projectId, opportunityId };

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
    return apiResponse(400, {
      message:
        'No processed solicitation documents for this opportunity. Upload at least one document and wait for text extraction before starting a Solution Plan.',
    });
  }

  const existing = await getSolutionPlanByOpportunity(key);
  if (
    existing &&
    (existing.status === 'GRILLING' || existing.status === 'GENERATING_SOT') &&
    !restart
  ) {
    return apiResponse(409, {
      message:
        'A Solution Plan run is already in progress for this opportunity. Pass restart: true to abandon it and start over.',
      code: 'SOLUTION_PLAN_RUN_IN_PROGRESS',
      solutionPlanStatus: existing.status,
    });
  }

  const runId = uuidv4();
  const userId = getUserId(event);
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
    createdBy: existing?.createdBy ?? userId,
    updatedBy: userId,
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

  setAuditContext(event, {
    action: 'AI_GENERATION_STARTED',
    resource: 'pipeline',
    resourceId: plan.id,
    orgId,
  });

  return apiResponse(202, {
    ok: true,
    solutionPlanId: plan.id,
    runId,
    status: plan.status,
    version: plan.version,
    regenerated: !!existing,
    wipedMessages,
  });
};

export const handler = withSentryLambda(
  middy(initSolutionPlan)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:create'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
