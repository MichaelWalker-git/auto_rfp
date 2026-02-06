import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { storeApiKey } from '../helpers/api-key-storage';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';
import { z } from 'zod';

const SaveLinearApiKeySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
});

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { message: 'OrgId is missing' });
    }

    const body = JSON.parse(event.body || '{}');
    const data = SaveLinearApiKeySchema.parse(body);
    const { apiKey } = data;

    // Store the API key with 'linear' prefix
    await storeApiKey(orgId, apiKey, 'linear');

    return apiResponse(200, {
      success: true,
      message: 'Linear API key saved successfully',
    });
  } catch (err: any) {
    console.error('Error saving Linear API key:', err);

    return apiResponse(500, {
      message: 'Failed to save API key',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read'))
    .use(httpErrorMiddleware()),
);
