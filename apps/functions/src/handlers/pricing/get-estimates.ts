import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { apiResponse } from '@/helpers/api';
import { getCostEstimatesByOpportunity } from '@/helpers/pricing';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

const GetEstimatesQuerySchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
});

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const { orgId, projectId, opportunityId } = event.queryStringParameters || {};

    if (!orgId || !projectId || !opportunityId) {
      return apiResponse(400, { message: 'Missing required query parameters: orgId, projectId, opportunityId' });
    }

    const { success, data, error } = GetEstimatesQuerySchema.safeParse({ orgId, projectId, opportunityId });
    if (!success) {
      return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });
    }

    const estimates = await getCostEstimatesByOpportunity(data.orgId, data.projectId, data.opportunityId);

    return apiResponse(200, { estimates });
  } catch (err: unknown) {
    console.error('Error in getEstimates handler:', err);
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
