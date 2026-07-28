/**
 * GET /compliance-review/run
 *
 * Returns the latest review run for an opportunity, the persisted finding
 * decisions, and a `stale` flag (true when the package changed since the run's
 * snapshot). Applies crash-recovery: a RUNNING run past the timeout is reported
 * as FAILED. The frontend polls this while status is RUNNING.
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';
import { getOpportunity } from '@/helpers/opportunity';
import {
  getLatestReviewRun,
  isRunStale,
  markRunFailed,
  listFindingDecisions,
  type ComplianceReviewRunItem,
} from '@/helpers/compliance-review';
import { buildPackageSnapshot, isSnapshotStale } from '@/helpers/compliance-review-snapshot';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { GetReviewResponseSchema } from '@auto-rfp/core';

const QueryParamsSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  projectId: z.string().min(1, 'projectId is required'),
  opportunityId: z.string().min(1, 'opportunityId is required'),
});

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const { success, data, error } = QueryParamsSchema.safeParse(event.queryStringParameters);
  if (!success) {
    return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });
  }
  const { orgId, projectId, opportunityId: oppId } = data;

  const opportunity = await getOpportunity({ orgId, projectId, oppId });
  if (!opportunity) return apiResponse(404, { message: 'Opportunity not found' });

  let run: ComplianceReviewRunItem | null = await getLatestReviewRun(orgId, projectId, oppId);

  // Crash recovery: a RUNNING run past the timeout is treated as FAILED.
  if (run && isRunStale(run)) {
    run = await markRunFailed(run, 'Review timed out — the worker did not finish.').catch(() => run);
  }

  const decisions = await listFindingDecisions(orgId, projectId, oppId);

  // Staleness: only meaningful for a completed run.
  let stale = false;
  if (run && run.status === 'READY') {
    const current = await buildPackageSnapshot({ orgId, projectId, oppId });
    stale = isSnapshotStale(run.snapshotVersionIds ?? {}, current);
  }

  const response = GetReviewResponseSchema.parse({ run, decisions, stale });
  return apiResponse(200, response);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read')),
);
