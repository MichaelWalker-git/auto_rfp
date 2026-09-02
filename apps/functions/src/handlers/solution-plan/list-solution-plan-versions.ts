/**
 * GET /solution-plan/versions
 *
 * List a plan's version history, newest first, at most 30 rows (BR1.1), plus
 * `currentVersionId` — the NEWEST row's versionId, derived from the SAME query
 * result (never a plan-item read, per the u2 performance design NFR2.7).
 * Empty history → 200 with an empty array and a null marker. Query params:
 * orgId, projectId, opportunityId (org scope from the request, BR4.1).
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { SolutionPlanVersionListRequestSchema } from '@auto-rfp/core';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  listSolutionPlanVersions,
  toSolutionPlanVersionListItem,
} from '@/helpers/solution-plan-version';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

export const listPlanVersions = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { success, data, error } = SolutionPlanVersionListRequestSchema.safeParse(
    event.queryStringParameters ?? {},
  );
  if (!success) {
    return apiResponse(400, { message: 'Validation failed', issues: error.issues });
  }

  // One helper call — newest first, ≤30 (contract C3). Storage errors are NOT
  // caught: they propagate and withSentryLambda reports them (NFR1.15).
  const items = await listSolutionPlanVersions(data);
  const versions = items.map(toSolutionPlanVersionListItem);
  const currentVersionId = versions[0]?.versionId ?? null;

  console.info(
    JSON.stringify({
      event: 'solution_plan_versions_listed',
      ...data,
      count: versions.length,
      currentVersionId,
      outcome: 200,
    }),
  );

  return apiResponse(200, { ok: true, versions, currentVersionId });
};

export const handler = withSentryLambda(
  middy(listPlanVersions)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:read'))
    .use(httpErrorMiddleware()),
);
