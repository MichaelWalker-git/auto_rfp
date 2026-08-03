/**
 * POST /compliance-review/run
 *
 * Kicks off an async full-package compliance review. Creates a RUNNING run
 * (guarded so only one is active per opportunity → 409 otherwise), snapshots
 * the current package versions, and enqueues the SQS worker.
 */
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';
import { getOpportunity } from '@/helpers/opportunity';
import { isComplianceReviewEnabled } from '@/helpers/compliance-review-access';
import { createReviewRun } from '@/helpers/compliance-review';
import { buildPackageSnapshot } from '@/helpers/compliance-review-snapshot';
import { enqueueComplianceReview } from '@/helpers/compliance-review-queue';
import { writeComplianceAuditLog } from '@/helpers/compliance-review-audit';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { TriggerReviewResponseSchema } from '@auto-rfp/core';

const QueryParamsSchema = z.object({
  orgId: z.string().min(1, 'orgId is required'),
  projectId: z.string().min(1, 'projectId is required'),
  opportunityId: z.string().min(1, 'opportunityId is required'),
});

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  const { success, data, error } = QueryParamsSchema.safeParse(event.queryStringParameters);
  if (!success) {
    return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });
  }
  const { orgId, projectId, opportunityId: oppId } = data;

  // Org-level feature gate (single-org feature, mirrors enablePOCGeneration).
  if (!(await isComplianceReviewEnabled(orgId))) {
    return apiResponse(403, { message: 'AI compliance review is not enabled for this organization' });
  }

  const opportunity = await getOpportunity({ orgId, projectId, oppId });
  if (!opportunity) return apiResponse(404, { message: 'Opportunity not found' });

  const snapshotVersionIds = await buildPackageSnapshot({ orgId, projectId, oppId });

  const run = await createReviewRun({ orgId, projectId, oppId, trigger: 'FULL', snapshotVersionIds });
  if (!run) {
    return apiResponse(409, { message: 'A review is already in progress for this opportunity.' });
  }

  await enqueueComplianceReview({ orgId, projectId, oppId, reviewId: run.reviewId });

  // Audit: a user kicked off a full AI review (mutating — creates a run).
  // Fire-and-forget: the write (getHmacSecret + DynamoDB) is non-blocking and
  // must not add latency to the user-facing response.
  void writeComplianceAuditLog({
    action: 'COMPLIANCE_REVIEW_STARTED',
    resource: 'compliance_review_run',
    resourceId: run.reviewId,
    orgId,
    userId: event.auth?.userId,
    userName:
      (event.auth?.claims?.name as string | undefined) ??
      (event.auth?.claims?.email as string | undefined),
    after: { oppId, projectId, trigger: 'FULL' },
    ipAddress: event.requestContext?.http?.sourceIp,
    userAgent: event.headers?.['user-agent'],
  });

  return apiResponse(
    202,
    TriggerReviewResponseSchema.parse({ reviewId: run.reviewId, status: run.status }),
  );
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(httpErrorMiddleware())
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    // Mutating (creates a review run) → gate on proposal:create, matching the
    // roles that actively prepare a submission (ADMIN/EDITOR/MEMBER). GET
    // endpoints stay on opportunity:read.
    .use(requirePermission('proposal:create')),
);
