/**
 * GET /package-edit/run
 *
 * Returns the latest proposal run for an opportunity plus a `stale` flag (true
 * when the package changed since the run's snapshot). Applies crash-recovery: a
 * PROPOSING run past the timeout is reported as FAILED. The frontend polls this
 * while status is PROPOSING.
 *
 * Mirrors compliance-review/get-review.ts. Permission: proposal:edit (poll a run
 * the user initiated).
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';
import { getOpportunity } from '@/helpers/opportunity';
import {
  getLatestProposalRun,
  getProposalRunById,
  isRunStale,
  markRunFailed,
  type PackageEditRunItem,
} from '@/helpers/package-edit';
import { buildPackageSnapshot, isSnapshotStale } from '@/helpers/compliance-review-snapshot';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { GetPackageEditRunResponseSchema } from '@auto-rfp/core';

const QueryParamsSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  projectId: z.string().min(1, 'projectId is required'),
  opportunityId: z.string().min(1, 'opportunityId is required'),
  // Optional: poll a SPECIFIC run instead of the opportunity's latest. The unified
  // chat passes the message's editRunId so an inline run view can't show a run
  // started from another surface (which would otherwise be "latest"). See W2.
  runId: z.string().min(1).optional(),
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

  let run: PackageEditRunItem | null = data.runId
    ? await getProposalRunById(orgId, projectId, oppId, data.runId)
    : await getLatestProposalRun(orgId, projectId, oppId);

  // Crash recovery: a PROPOSING run past the timeout is treated as FAILED.
  if (run && isRunStale(run)) {
    run = await markRunFailed(run, 'Proposal scan timed out — the worker did not finish.').catch(() => run);
  }

  // Staleness: only meaningful for a completed run whose proposals could be applied.
  let stale = false;
  if (run && run.status === 'PROPOSED') {
    const current = await buildPackageSnapshot({ orgId, projectId, oppId });
    stale = isSnapshotStale(run.snapshotVersionIds ?? {}, current);
  }

  const response = GetPackageEditRunResponseSchema.parse({ run, stale });
  return apiResponse(200, response);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:edit')),
);
