/**
 * POST /solution-plan/init
 *
 * Start (or regenerate) the Solution Plan grilling run for an opportunity.
 * All orchestration (preflight, in-flight guard, upsert → wipe → enqueue)
 * lives in `initSolutionPlanRun`; this handler only validates the body and
 * maps the outcome to an HTTP response.
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { SolutionPlanInitRequestSchema } from '@auto-rfp/core';

import { apiResponse, getUserId, parseJsonBody } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { initSolutionPlanRun } from '@/helpers/solution-plan-init';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

export const initSolutionPlan = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { success, data, error } = SolutionPlanInitRequestSchema.safeParse(parseJsonBody(event));
  if (!success) {
    return apiResponse(400, { message: 'Validation failed', issues: error.issues });
  }

  const { orgId, projectId, opportunityId, restart } = data;
  const result = await initSolutionPlanRun(
    { orgId, projectId, opportunityId },
    { restart, userId: getUserId(event) },
  );

  if (result.outcome === 'NO_PROCESSED_FILES') {
    return apiResponse(400, {
      message:
        'No processed solicitation documents for this opportunity. Upload at least one document and wait for text extraction before starting a Solution Plan.',
    });
  }
  if (result.outcome === 'RUN_IN_PROGRESS') {
    return apiResponse(409, {
      message:
        'A Solution Plan run is already in progress for this opportunity. Pass restart: true to abandon it and start over.',
      code: 'SOLUTION_PLAN_RUN_IN_PROGRESS',
      solutionPlanStatus: result.solutionPlanStatus,
    });
  }

  const { plan, regenerated, wipedMessages } = result;

  setAuditContext(event, {
    action: 'AI_GENERATION_STARTED',
    resource: 'pipeline',
    resourceId: plan.id,
    orgId,
  });

  return apiResponse(202, {
    ok: true,
    solutionPlanId: plan.id,
    runId: plan.runId,
    status: plan.status,
    version: plan.version,
    regenerated,
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
