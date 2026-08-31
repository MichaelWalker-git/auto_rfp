/**
 * DELETE /solution-plan/version
 *
 * Delete a NON-current version (contract C1). The guards live inside u1's
 * `deleteSolutionPlanVersion` helper — this handler maps its outcomes:
 * NOT_FOUND → 404 (already deleted, BR3.3), REFUSED_CURRENT → 409 (the newest
 * history record is never deletable, BR3.1), DELETED → 200 (record first,
 * body second — retry-converging, NFR1.11). Query params: orgId, projectId,
 * opportunityId, versionId.
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { SolutionPlanVersionDeleteRequestSchema } from '@auto-rfp/core';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { deleteSolutionPlanVersion } from '@/helpers/solution-plan-version';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

export const deletePlanVersion = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { success, data, error } = SolutionPlanVersionDeleteRequestSchema.safeParse(
    event.queryStringParameters ?? {},
  );
  if (!success) {
    return apiResponse(400, { message: 'Validation failed', issues: error.issues });
  }

  const { versionId, ...key } = data;

  // Guards precede the record delete inside the helper — a rejection has zero
  // mutation (NFR1.12). Storage errors propagate to withSentryLambda (NFR1.15).
  const result = await deleteSolutionPlanVersion(key, versionId);

  if (result.outcome === 'NOT_FOUND') {
    // Expected race — RETURNED, never thrown (NFR1.14); info log at the guard.
    console.info(
      JSON.stringify({
        event: 'solution_plan_version_delete_not_found',
        ...key,
        versionId,
        outcome: 404,
      }),
    );
    return apiResponse(404, { message: 'Version not found' });
  }

  if (result.outcome === 'REFUSED_CURRENT') {
    console.info(
      JSON.stringify({
        event: 'solution_plan_version_delete_refused_current',
        ...key,
        versionId,
        outcome: 409,
      }),
    );
    return apiResponse(409, {
      message: 'The current version cannot be deleted.',
      code: 'SOLUTION_PLAN_VERSION_CURRENT',
    });
  }

  console.info(
    JSON.stringify({
      event: 'solution_plan_version_deleted',
      ...key,
      versionId,
      outcome: 200,
    }),
  );

  return apiResponse(200, { ok: true, versionId });
};

export const handler = withSentryLambda(
  middy(deletePlanVersion)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:create'))
    .use(httpErrorMiddleware()),
);
