import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { apiResponse } from '@/helpers/api';
import { getBOMItemsByOrg } from '@/helpers/pricing';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

const GetBOMItemsQuerySchema = z.object({
  orgId: z.string().uuid(),
  category: z.string().optional(),
});

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const { orgId, category } = event.queryStringParameters || {};

    if (!orgId) {
      return apiResponse(400, { message: 'Missing required query parameter: orgId' });
    }

    const { success, data, error } = GetBOMItemsQuerySchema.safeParse({ orgId, category });
    if (!success) {
      return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });
    }

    const bomItems = await getBOMItemsByOrg(data.orgId, data.category);

    return apiResponse(200, { bomItems });
  } catch (err: unknown) {
    console.error('Error in getBOMItems handler:', err);
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
