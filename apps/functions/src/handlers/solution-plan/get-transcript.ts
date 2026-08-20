/**
 * GET /solution-plan/transcript
 *
 * Return the grilling interview transcript for an opportunity's plan, in
 * round/time order. Only the current run's messages are returned — leftovers
 * from a superseded run (zombie appends after a wipe) are filtered out by
 * runId (ADR-5). Query params: orgId, projectId, opportunityId.
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { SolutionPlanKeySchema } from '@auto-rfp/core';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  getSolutionPlanByOpportunity,
  listGrillingMessages,
  toGrillingMessageItem,
} from '@/helpers/solution-plan';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

export const getTranscript = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
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

  const allMessages = await listGrillingMessages(plan.id);
  const messages = allMessages
    .filter((m) => m.runId === plan.runId)
    .map(toGrillingMessageItem);

  return apiResponse(200, {
    ok: true,
    solutionPlanId: plan.id,
    runId: plan.runId,
    status: plan.status,
    messages,
  });
};

export const handler = withSentryLambda(
  middy(getTranscript)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:read'))
    .use(httpErrorMiddleware()),
);
