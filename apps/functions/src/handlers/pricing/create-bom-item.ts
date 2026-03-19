import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { CreateBOMItemSchema, type CreateBOMItem, type BOMItem } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { nowIso } from '@/helpers/date';
import { createBOMItem } from '@/helpers/pricing';
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
    const { success, data, error } = CreateBOMItemSchema.safeParse(rawBody);

    if (!success) {
      return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
    }

    const dto: CreateBOMItem = data;
    const userId = event.auth?.userId || 'unknown';
    const now = nowIso();

    const bomItem: BOMItem = {
      ...dto,
      bomItemId: uuidv4(),
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      updatedBy: userId,
    };

    const result = await createBOMItem(bomItem);

    return apiResponse(201, { bomItem: result });
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === 'ConditionalCheckFailedException' || err.message === 'The conditional request failed')) {
      return apiResponse(400, {
        message: 'A BOM item with this name and category already exists.',
      });
    }

    console.error('Error in createBOMItem handler:', err);
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
    .use(httpErrorMiddleware()),
);
