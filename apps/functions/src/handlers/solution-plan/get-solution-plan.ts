/**
 * GET /solution-plan/get
 *
 * Return the Solution Plan record for an opportunity (metadata only — the
 * HTML body is served by get-html-content). Query params: orgId, projectId,
 * opportunityId.
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { SolutionPlanKeySchema } from '@auto-rfp/core';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getSolutionPlanByOpportunity, toSolutionPlanItem } from '@/helpers/solution-plan';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

export const getSolutionPlan = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
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

  return apiResponse(200, { ok: true, plan: toSolutionPlanItem(plan) });
};

export const handler = withSentryLambda(
  middy(getSolutionPlan)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:read'))
    .use(httpErrorMiddleware()),
);
