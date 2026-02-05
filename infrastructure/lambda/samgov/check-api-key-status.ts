import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { getApiKey } from '../helpers/api-key-storage';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { message: 'OrgId is missing' });
    }

    try {
      const apiKey = await getApiKey(orgId);
      return apiResponse(200, { 
        hasApiKey: !!apiKey,
        message: apiKey ? 'API key is configured' : 'API key is not configured'
      });
    } catch (error) {
      console.error('Error checking API key:', error);
      return apiResponse(200, { 
        hasApiKey: false,
        message: 'API key is not configured or error accessing it',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  } catch (err: any) {
    console.error('Error in check API key handler:', err);
    return apiResponse(500, {
      message: 'Failed to check API key status',
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