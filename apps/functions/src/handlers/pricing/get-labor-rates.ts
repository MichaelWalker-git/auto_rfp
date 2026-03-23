import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { apiResponse } from '@/helpers/api';
import { getLaborRatesByOrg } from '@/helpers/pricing';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

const GetLaborRatesQuerySchema = z.object({
  orgId: z.string().uuid(),
  position: z.string().optional(),
});

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const { orgId, position } = event.queryStringParameters || {};

    if (!orgId) {
      return apiResponse(400, { message: 'Missing required query parameter: orgId' });
    }

    const { success, data, error } = GetLaborRatesQuerySchema.safeParse({ orgId, position });

    if (!success) {
      return apiResponse(400, { message: 'Invalid query parameters', issues: error.issues });
    }

    let laborRates = await getLaborRatesByOrg(data.orgId);

    // Filter by position if provided
    if (data.position) {
      laborRates = laborRates.filter(rate => 
        rate.position.toLowerCase().includes(data.position!.toLowerCase())
      );
    }

    return apiResponse(200, { laborRates });
  } catch (err: unknown) {
    console.error('Error in getLaborRates handler:', err);
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
    .use(httpErrorMiddleware())
);
