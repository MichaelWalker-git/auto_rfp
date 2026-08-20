/**
 * PATCH /solution-plan/team/save
 *
 * Persist a human-edited team (W3, BR3.1): the body carries the plan key
 * triple + the full member list. The helper reconciles every line against the
 * live pool (snapshots refreshed, dangling references marked — BR3.3), sets
 * `userModified` + `savedAt`, and bumps the plan's monotonic version. From
 * this save on, the team survives plan regenerations (BR1.2) and is what
 * downstream documents read (BR3.2). Gated by the existing solution-plan
 * edit permission (FR5.2, BR5.1).
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { PlanTeamSaveRequestSchema, SolutionPlanKeySchema } from '@auto-rfp/core';

import { apiResponse, parseJsonBody } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { saveUserEditedTeam } from '@/helpers/plan-team';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

/** The route carries identifiers alongside the members — compose the core schemas. */
const SavePlanTeamBodySchema = SolutionPlanKeySchema.merge(PlanTeamSaveRequestSchema);

export const savePlanTeam = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { success, data, error } = SavePlanTeamBodySchema.safeParse(parseJsonBody(event));
  if (!success) {
    return apiResponse(400, { message: 'Validation failed', issues: error.issues });
  }

  const { orgId, projectId, opportunityId, members } = data;

  const team = await saveUserEditedTeam({ orgId, projectId, opportunityId }, members);
  if (!team) {
    return apiResponse(404, { message: 'Solution plan not found' });
  }

  return apiResponse(200, { ok: true, team });
};

export const handler = withSentryLambda(
  middy(savePlanTeam)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:create'))
    .use(httpErrorMiddleware()),
);
