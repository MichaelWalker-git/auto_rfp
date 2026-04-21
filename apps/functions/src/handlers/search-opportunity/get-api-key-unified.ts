/**
 * Unified get-api-key handler.
 * GET /search-opportunities/api-key?orgId=...&source=SAM_GOV|DIBBS
 *
 * Returns API key status for all configured sources (or a specific source).
 */
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { getApiKey } from '@/helpers/api-key-storage';
import { SAM_GOV_SECRET_PREFIX } from '@/constants/samgov';
import { DIBBS_SECRET_PREFIX } from '@/constants/dibbs';
import { HIGHERGOV_SECRET_PREFIX } from '@/constants/highergov';

const SOURCE_TO_PREFIX: Record<string, string> = {
  SAM_GOV: SAM_GOV_SECRET_PREFIX,
  DIBBS: DIBBS_SECRET_PREFIX,
  HIGHER_GOV: HIGHERGOV_SECRET_PREFIX,
};

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const sourceParam = event.queryStringParameters?.source?.toUpperCase();

  // If a specific source is requested, return just that one
  const prefix = sourceParam ? SOURCE_TO_PREFIX[sourceParam] : undefined;
  if (sourceParam && prefix) {
    const apiKey = await getApiKey(orgId, prefix);
    return apiResponse(200, { orgId, source: sourceParam, configured: !!apiKey, apiKey: apiKey ?? null });
  }

  // Return status for all sources
  const [samKey, dibbsKey, higherGovKey] = await Promise.all([
    getApiKey(orgId, SAM_GOV_SECRET_PREFIX),
    getApiKey(orgId, DIBBS_SECRET_PREFIX),
    getApiKey(orgId, HIGHERGOV_SECRET_PREFIX),
  ]);

  return apiResponse(200, {
    orgId,
    sources: {
      SAM_GOV:    { configured: !!samKey, apiKey: samKey ?? null },
      DIBBS:      { configured: !!dibbsKey, apiKey: dibbsKey ?? null },
      HIGHER_GOV: { configured: !!higherGovKey, apiKey: higherGovKey ?? null },
    },
    anyConfigured: !!(samKey || dibbsKey || higherGovKey),
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:manage_settings'))
    .use(httpErrorMiddleware()),
);
