import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { apiResponse } from '@/helpers/api';
import { deleteStaffingPlan } from '@/helpers/pricing';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

const DeleteStaffingPlanQuerySchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  staffingPlanId: z.string().uuid(),
});

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const { orgId, projectId, opportunityId, staffingPlanId } = event.queryStringParameters || {};

    const { success, data, error } = DeleteStaffingPlanQuerySchema.safeParse({
      orgId, projectId, opportunityId, staffingPlanId,
    });
    if (!success) {
      return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });
    }

    await deleteStaffingPlan(data.orgId, data.projectId, data.opportunityId, data.staffingPlanId);

    return apiResponse(200, { message: 'Staffing plan deleted', staffingPlanId: data.staffingPlanId });
  } catch (err: unknown) {
    console.error('Error in deleteStaffingPlan handler:', err);
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
    .use(requirePermission('pricing:delete'))
    .use(httpErrorMiddleware()),
);
