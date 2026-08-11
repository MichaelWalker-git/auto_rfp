/**
 * PATCH /solution-plan/update
 *
 * Persist a manual edit of the plan's HTML content. Editable only when the
 * plan is READY — anything else returns 409 (ADR-8; content exists ⇔
 * editable). The edit bumps the monotonic version (ADR-11), uploads a fresh
 * S3 object, marks the plan user-edited, and clears staleness.
 */

import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { SolutionPlanKeySchema, SolutionPlanUpdateRequestSchema } from '@auto-rfp/core';

import { apiResponse, getUserId, parseJsonBody } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  getSolutionPlanByOpportunity,
  toSolutionPlanItem,
  updateSolutionPlanContent,
  uploadSolutionPlanHtml,
} from '@/helpers/solution-plan';
import {
  authContextMiddleware,
  type AuthedEvent,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

/** The route carries identifiers alongside the patch — compose the two core schemas. */
const UpdateSolutionPlanBodySchema = SolutionPlanKeySchema.merge(SolutionPlanUpdateRequestSchema);

export const updateSolutionPlan = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { success, data, error } = UpdateSolutionPlanBodySchema.safeParse(parseJsonBody(event));
  if (!success) {
    return apiResponse(400, { message: 'Validation failed', issues: error.issues });
  }

  const { orgId, projectId, opportunityId, htmlContent } = data;
  const key = { orgId, projectId, opportunityId };

  const plan = await getSolutionPlanByOpportunity(key);
  if (!plan) {
    return apiResponse(404, { message: 'Solution plan not found' });
  }
  if (plan.status !== 'READY') {
    return apiResponse(409, {
      message: 'Solution plan content can only be edited when the plan is READY.',
      code: 'SOLUTION_PLAN_NOT_READY',
      solutionPlanStatus: plan.status,
    });
  }

  // Monotonic bump (ADR-11). Uploading before the conditional update is safe:
  // if the update loses a race with a re-init, the orphan S3 object is
  // unreferenced and the next synthesis overwrites the same versioned key.
  const version = plan.version + 1;
  const contentKey = await uploadSolutionPlanHtml(key, version, htmlContent);

  const updated = await updateSolutionPlanContent(key, {
    version,
    contentKey,
    editedBy: getUserId(event),
  });
  if (!updated) {
    // Conditional write failed between the read above and the write — either
    // a regenerate flipped the status or a concurrent edit claimed this
    // version first (ADR-11: versions never collide).
    return apiResponse(409, {
      message: 'Solution plan changed while you were editing. Reload and try again.',
      code: 'SOLUTION_PLAN_CONFLICT',
    });
  }

  return apiResponse(200, { ok: true, plan: toSolutionPlanItem(updated) });
};

export const handler = withSentryLambda(
  middy(updateSolutionPlan)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:create'))
    .use(httpErrorMiddleware()),
);
