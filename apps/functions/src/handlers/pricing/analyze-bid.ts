import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';
import { apiResponse } from '@/helpers/api';
import { getCostEstimateById, analyzePricingForBid } from '@/helpers/pricing';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

const AnalyzeBidRequestSchema = z.object({
  orgId: z.string().uuid(),
  projectId: z.string().uuid(),
  opportunityId: z.string().uuid(),
  estimateId: z.string().uuid(),
  priceToWinEstimate: z.number().nonnegative().optional(),
});

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const rawBody = JSON.parse(event.body || '{}');
    const { success, data, error } = AnalyzeBidRequestSchema.safeParse(rawBody);

    if (!success) {
      return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
    }

    // Get the cost estimate
    const estimate = await getCostEstimateById(
      data.orgId,
      data.projectId,
      data.opportunityId,
      data.estimateId,
    );

    if (!estimate) {
      return apiResponse(404, { message: 'Cost estimate not found' });
    }

    // Run bid/no-bid pricing analysis
    const analysis = analyzePricingForBid(estimate, data.priceToWinEstimate);

    return apiResponse(200, { analysis });
  } catch (err: unknown) {
    console.error('Error in analyzeBid handler:', err);
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
