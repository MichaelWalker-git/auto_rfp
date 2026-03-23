import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { CreateLaborRateSchema, type CreateLaborRate, type LaborRate } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { nowIso } from '@/helpers/date';
import { createLaborRate, calculateFullyLoadedRate } from '@/helpers/pricing';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  try {
    const rawBody = JSON.parse(event.body || '{}');
    const { success, data, error } = CreateLaborRateSchema.safeParse(rawBody);

    if (!success) {
      return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
    }

    const dto: CreateLaborRate = data;
    const userId = event.auth?.userId || 'unknown';
    const now = nowIso();

    // Calculate fully loaded rate
    const fullyLoadedRate = calculateFullyLoadedRate(dto.baseRate, dto.overhead, dto.ga, dto.profit);

    const laborRate: LaborRate = {
      ...dto,
      laborRateId: uuidv4(),
      fullyLoadedRate,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    const result = await createLaborRate(laborRate);

    return apiResponse(201, { laborRate: result });
  } catch (err: unknown) {
    // Handle duplicate position (DynamoDB conditional check failure)
    if (err instanceof Error && (err.name === 'ConditionalCheckFailedException' || err.message === 'The conditional request failed')) {
      return apiResponse(400, {
        message: `A labor rate for this position already exists. Use a unique position name or update the existing rate.`,
      });
    }

    console.error('Error in createLaborRate handler:', err);
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
    .use(requirePermission('pricing:create'))
    .use(httpErrorMiddleware())
);
