import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { apiResponse } from '@/helpers/api';
import { getStaffingPlansByOpportunity, getStaffingPlansByProject } from '@/helpers/pricing';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

const GetStaffingPlansQuerySchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid().optional(),
});

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const { orgId, projectId, opportunityId } = event.queryStringParameters || {};

    if (!orgId || !projectId) {
      return apiResponse(400, { message: 'Missing required query parameters: orgId, projectId' });
    }

    const { success, data, error } = GetStaffingPlansQuerySchema.safeParse({ orgId, projectId, opportunityId });
    if (!success) {
      return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });
    }

    const staffingPlans = data.opportunityId
      ? await getStaffingPlansByOpportunity(data.orgId, data.projectId, data.opportunityId)
      : await getStaffingPlansByProject(data.orgId, data.projectId);

    return apiResponse(200, { staffingPlans });
  } catch (err: unknown) {
    console.error('Error in getStaffingPlans handler:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('pricing:read'))
    .use(httpErrorMiddleware()),
);
