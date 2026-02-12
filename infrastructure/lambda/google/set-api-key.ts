import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { storeApiKey } from '../helpers/api-key-storage';
import { apiResponse, getOrgId } from '../helpers/api';
import { ApiKeyRequestSchema } from '@auto-rfp/shared';
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

    const { success, data } = ApiKeyRequestSchema.safeParse(JSON.parse(event.body || ''));
    if (!success) {
      return apiResponse(400, { error: 'Invalid or missing API key' });
    }

    const { apiKey } = data;

    await storeApiKey(orgId, GOOGLE_SECRET_PREFIX, apiKey);

    return apiResponse(201, {
      message: 'API key stored successfully',
      orgId,
    });
  } catch (error) {
    console.error('Error storing Google API key', JSON.stringify(error, null, 2));
    return apiResponse(500, { error: 'Failed to store API key' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:edit'))
    .use(httpErrorMiddleware()),
);