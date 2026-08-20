/**
 * GET /solution-plan/team
 *
 * Return the plan's team (team-definition U3) with `removedEmployee` DERIVED
 * against the live org pool on every read (BR3.3 — the pinned design
 * decision). Query params: orgId, projectId, opportunityId. `team: null`
 * means the plan has no team yet (pre-synthesis or empty-pool prerequisite).
 * Read gated by the existing solution-plan read permission (FR5.2).
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { SolutionPlanKeySchema } from '@auto-rfp/core';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { getDerivedPlanTeam } from '@/helpers/plan-team';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

export const getPlanTeam = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { success, data, error } = SolutionPlanKeySchema.safeParse(
    event.queryStringParameters ?? {},
  );
  if (!success) {
    return apiResponse(400, { message: 'Validation failed', issues: error.issues });
  }

  const { planExists, team } = await getDerivedPlanTeam(data);
  if (!planExists) {
    return apiResponse(404, { message: 'Solution plan not found' });
  }

  return apiResponse(200, { ok: true, team });
};

export const handler = withSentryLambda(
  middy(getPlanTeam)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:read'))
    .use(httpErrorMiddleware()),
);
