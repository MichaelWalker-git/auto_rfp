import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import https from 'https';

import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';

import { type LoadSamOpportunitiesRequest, LoadSamOpportunitiesRequestSchema, } from '@auto-rfp/core';

import { searchSamOpportunities } from '@/helpers/samgov';
import { getApiKey } from '@/helpers/api-key-storage';
import { SAM_GOV_SECRET_PREFIX } from '@/constants/samgov';

const SAM_BASE_URL = requireEnv('SAM_OPPS_BASE_URL', 'https://api.sam.gov');

// reuse sockets across invocations
const httpsAgent = new https.Agent({ keepAlive: true });


export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) {
      console.error('OrgId is missing from event:', {
        headers: event.headers,
        queryStringParameters: event.queryStringParameters,
        requestContext: event.requestContext,
      });
      return apiResponse(400, { message: 'OrgId is missing' });
    }
    if (!event.body) return apiResponse(400, { message: 'Request body is required' });

    let raw: unknown;
    try {
      raw = JSON.parse(event.body);
    } catch {
      return apiResponse(400, { message: 'Invalid JSON body' });
    }

    const parsed = LoadSamOpportunitiesRequestSchema.safeParse(raw);
    if (!parsed.success) {
      return apiResponse(400, { message: 'Validation error', errors: parsed.error.format() });
    }

    const body: LoadSamOpportunitiesRequest = parsed.data;

    let apiKey: string | null = null;
    try {
      apiKey = await getApiKey(orgId, SAM_GOV_SECRET_PREFIX);
    } catch (apiKeyError) {
      console.error('Error retrieving API key for orgId:', orgId, apiKeyError);
      return apiResponse(500, { 
        message: 'Failed to retrieve SAM.gov API key', 
        error: apiKeyError instanceof Error ? apiKeyError.message : 'Unknown error retrieving API key'
      });
    }

    if (!apiKey) {
      console.error('API key not found for orgId:', orgId);
      return apiResponse(404, { message: 'SAM.gov API key not configured for this organization' });
    }

    const resp = await searchSamOpportunities(
      { baseUrl: SAM_BASE_URL, apiKey, httpsAgent },
      body,
    );

    return apiResponse(200, resp);
  } catch (err: any) {
    console.error('Error in SAM search handler:', err);
    return apiResponse(500, {
      message: 'Failed to search opportunities from SAM.gov',
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