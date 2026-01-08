import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import https from 'https';

import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import { requireEnv } from '../helpers/env';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';

import { type LoadSamOpportunitiesRequest, LoadSamOpportunitiesRequestSchema, } from '@auto-rfp/shared';

import { readPlainSecret } from '../helpers/secret';
import { searchSamOpportunities } from '../helpers/samgov';

const SAM_BASE_URL = requireEnv('SAM_OPPS_BASE_URL', 'https://api.sam.gov');
const SAM_GOV_API_KEY_SECRET_ID = requireEnv('SAM_GOV_API_KEY_SECRET_ID');

// reuse sockets across invocations
const httpsAgent = new https.Agent({ keepAlive: true });

// cache key in warm lambda
let cachedApiKey: string | null = null;

async function getApiKey(): Promise<string> {
  if (cachedApiKey) return cachedApiKey;
  cachedApiKey = await readPlainSecret(SAM_GOV_API_KEY_SECRET_ID);
  return cachedApiKey;
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
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

    const apiKey = await getApiKey();

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