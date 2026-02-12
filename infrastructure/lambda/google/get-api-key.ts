import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { getApiKey } from '../helpers/api-key-storage';
import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { GOOGLE_SECRET_PREFIX } from '../constants/google';

export const baseHandler = async (event: APIGatewayProxyEventV2) => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { message: 'Org Id is required' });
    }

    const apiKey = await getApiKey(orgId, GOOGLE_SECRET_PREFIX);

    if (!apiKey) {
      return apiResponse(404, { error: 'API key not found for this organization' });
    }

    return apiResponse(200, {
      message: 'API key retrieved successfully',
      apiKey,
      orgId,
    });
  } catch (error) {
    console.error('Error getting Google API key', JSON.stringify(error, null, 2));
    return apiResponse(500, { error: 'Failed to retrieve API key' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:read'))
    .use(httpErrorMiddleware()),
);
