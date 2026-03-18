import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { apiResponse } from '@/helpers/api';
import { getBOMItemsByOrg, deleteBOMItem } from '@/helpers/pricing';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

const DeleteBOMItemQuerySchema = z.object({
  orgId: z.string().uuid(),
  bomItemId: z.string().uuid(),
});

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const { orgId, bomItemId } = event.queryStringParameters || {};

    const { success, data, error } = DeleteBOMItemQuerySchema.safeParse({ orgId, bomItemId });
    if (!success) {
      return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });
    }

    // Find the BOM item to get its category (needed for SK)
    const allItems = await getBOMItemsByOrg(data.orgId);
    const found = allItems.find(i => i.bomItemId === data.bomItemId);
    if (!found) {
      return apiResponse(404, { message: 'BOM item not found' });
    }

    await deleteBOMItem(data.orgId, found.category, data.bomItemId);

    return apiResponse(200, { message: 'BOM item deleted', bomItemId: data.bomItemId });
  } catch (err: unknown) {
    console.error('Error in deleteBOMItem handler:', err);
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
