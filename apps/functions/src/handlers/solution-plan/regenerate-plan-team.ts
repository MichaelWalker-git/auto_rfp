/**
 * POST /solution-plan/team/regenerate
 *
 * The explicit team-regenerate action (W4): a fresh recommendation REPLACES
 * the current team — even a user-modified one; the frontend confirms first —
 * and `userModified` resets (BR1.2). An empty pool is the prerequisite state,
 * not an error (BR4.1). A matching failure returns 502 with a retriable,
 * plain-language message and leaves the existing team untouched (BR4.2).
 * Gated by the existing solution-plan edit permission (FR5.2, BR5.1).
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { SolutionPlanKeySchema } from '@auto-rfp/core';

import { apiResponse, parseJsonBody } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { regenerateTeam } from '@/helpers/plan-team';
import { TeamMatchingError } from '@/helpers/team-matching';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

export const regeneratePlanTeam = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  const { success, data, error } = SolutionPlanKeySchema.safeParse(parseJsonBody(event));
  if (!success) {
    return apiResponse(400, { message: 'Validation failed', issues: error.issues });
  }

  try {
    const result = await regenerateTeam(data);

    if (result.status === 'PLAN_NOT_FOUND') {
      return apiResponse(404, { message: 'Solution plan not found' });
    }
    if (result.status === 'EMPTY_POOL') {
      // Prerequisite state, not an error (BR4.1) — the section explains and
      // links to the Team page.
      return apiResponse(200, { ok: true, team: null, emptyPool: true });
    }

    return apiResponse(200, { ok: true, team: result.team });
  } catch (err) {
    if (err instanceof TeamMatchingError) {
      // BR4.2 — the existing team is untouched; the section shows retry and
      // manual assembly stays available.
      console.warn('[regenerate-plan-team] matching failed:', err.message);
      return apiResponse(502, {
        message: 'Team recommendation failed. The current team was left unchanged — retry, or build the team manually.',
        code: 'TEAM_MATCHING_FAILED',
      });
    }
    throw err;
  }
};

export const handler = withSentryLambda(
  middy(regeneratePlanTeam)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:create'))
    .use(httpErrorMiddleware()),
);
