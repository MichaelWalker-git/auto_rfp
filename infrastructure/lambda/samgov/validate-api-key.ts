import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { getApiKey } from '../helpers/api-key-storage';
import { apiResponse, getOrgId } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';

const SAM_GOV_API_BASE_URL = 'https://api.sam.gov/opportunities/v2';

export const baseHandler = async (event: APIGatewayProxyEventV2) => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      return apiResponse(400, { message: 'Org Id is required' });
    }

    const apiKey = await getApiKey(orgId);

    if (!apiKey) {
      return apiResponse(404, { 
        error: 'API key not found for this organization',
        valid: false,
      });
    }

    // Make a simple test request to SAM.gov API to validate the key
    try {
      const testUrl = `${SAM_GOV_API_BASE_URL}/search?limit=1&api_key=${apiKey}`;
      const response = await fetch(testUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      });

      if (response.status === 200) {
        return apiResponse(200, {
          message: 'API key is valid',
          valid: true,
          orgId,
        });
      } else if (response.status === 401 || response.status === 403) {
        return apiResponse(200, {
          message: 'API key is invalid or expired',
          valid: false,
          orgId,
          samGovStatus: response.status,
        });
      } else if (response.status === 429) {
        return apiResponse(200, {
          message: 'API key is valid but rate limit exceeded',
          valid: true,
          rateLimitExceeded: true,
          orgId,
        });
      } else {
        return apiResponse(200, {
          message: 'Unable to validate API key',
          valid: null,
          orgId,
          samGovStatus: response.status,
        });
      }
    } catch (error) {
      console.error('Error validating API key with SAM.gov', error);
      return apiResponse(200, {
        message: 'Unable to validate API key due to network error',
        valid: null,
        orgId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  } catch (error) {
    console.error('Error validating API key', error);
    return apiResponse(500, { error: 'Failed to validate API key' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:read'))
    .use(httpErrorMiddleware()),
);