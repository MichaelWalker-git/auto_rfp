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

    // Validate that the key is a valid Google Service Account JSON
    try {
      const parsed = JSON.parse(apiKey);
      if (!parsed.client_email || !parsed.private_key) {
        return apiResponse(400, {
          error: 'Invalid Google Service Account key: missing "client_email" or "private_key". Please provide a valid Service Account JSON key file contents.',
        });
      }
    } catch {
      return apiResponse(400, {
        error: 'Invalid JSON format. Please provide the full contents of a Google Service Account JSON key file (not a simple API key).',
      });
    }

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