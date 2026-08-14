/**
 * GET /solution-plan/html-content
 *
 * Return the synthesized (or user-edited) HTML body of the plan from S3.
 * While a run is in flight the content doesn't exist yet → 202; a FAILED
 * plan → 422 with the stored error. Query params: orgId, projectId,
 * opportunityId.
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { SolutionPlanKeySchema } from '@auto-rfp/core';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getSolutionPlanByOpportunity, loadSolutionPlanHtml } from '@/helpers/solution-plan';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

export const getHtmlContent = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { success, data, error } = SolutionPlanKeySchema.safeParse(
    event.queryStringParameters ?? {},
  );
  if (!success) {
    return apiResponse(400, { message: 'Validation failed', issues: error.issues });
  }

  const plan = await getSolutionPlanByOpportunity(data);
  if (!plan) {
    return apiResponse(404, { message: 'Solution plan not found' });
  }

  if (!plan.contentKey) {
    if (plan.status === 'GRILLING' || plan.status === 'GENERATING_SOT') {
      return apiResponse(202, {
        message: 'Solution plan is still being generated',
        solutionPlanStatus: plan.status,
      });
    }
    if (plan.status === 'FAILED') {
      return apiResponse(422, {
        message: 'Solution plan generation failed',
        error: plan.error ?? 'Unknown error',
      });
    }
    return apiResponse(404, { message: 'Solution plan content not available' });
  }

  const html = await loadSolutionPlanHtml(plan.contentKey);

  return apiResponse(200, {
    ok: true,
    html,
    contentKey: plan.contentKey,
    version: plan.version,
    isStale: plan.isStale,
    isUserEdited: plan.isUserEdited,
  });
};

export const handler = withSentryLambda(
  middy(getHtmlContent)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:read'))
    .use(httpErrorMiddleware()),
);
