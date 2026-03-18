import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { apiResponse } from '@/helpers/api';
import { getLaborRatesByOrg, deleteLaborRate } from '@/helpers/pricing';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

const DeleteLaborRateQuerySchema = z.object({
  orgId: z.string().uuid(),
  laborRateId: z.string().uuid(),
});

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const { orgId, laborRateId } = event.queryStringParameters || {};

    const { success, data, error } = DeleteLaborRateQuerySchema.safeParse({ orgId, laborRateId });
    if (!success) {
      return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });
    }

    // Find the labor rate to get its position (needed for SK)
    const allRates = await getLaborRatesByOrg(data.orgId);
    const found = allRates.find(r => r.laborRateId === data.laborRateId);
    if (!found) {
      return apiResponse(404, { message: 'Labor rate not found' });
    }

    await deleteLaborRate(data.orgId, found.position);

    return apiResponse(200, { message: 'Labor rate deleted', laborRateId: data.laborRateId });
  } catch (err: unknown) {
    console.error('Error in deleteLaborRate handler:', err);
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
