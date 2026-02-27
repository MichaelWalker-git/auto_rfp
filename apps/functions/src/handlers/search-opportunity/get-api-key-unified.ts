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

export const baseHandler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const sourceParam = event.queryStringParameters?.source?.toUpperCase();

  // If a specific source is requested, return just that one
  if (sourceParam === 'SAM_GOV') {
    const apiKey = await getApiKey(orgId, SAM_GOV_SECRET_PREFIX);
    return apiResponse(200, { orgId, source: 'SAM_GOV', configured: !!apiKey, apiKey: apiKey ?? null });
  }
  if (sourceParam === 'DIBBS') {
    const apiKey = await getApiKey(orgId, DIBBS_SECRET_PREFIX);
    return apiResponse(200, { orgId, source: 'DIBBS', configured: !!apiKey, apiKey: apiKey ?? null });
  }

  // Return status for all sources
  const [samKey, dibbsKey] = await Promise.all([
    getApiKey(orgId, SAM_GOV_SECRET_PREFIX),
    getApiKey(orgId, DIBBS_SECRET_PREFIX),
  ]);

  return apiResponse(200, {
    orgId,
    sources: {
      SAM_GOV: { configured: !!samKey, apiKey: samKey ?? null },
      DIBBS:   { configured: !!dibbsKey, apiKey: dibbsKey ?? null },
    },
    anyConfigured: !!(samKey || dibbsKey),
  });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:manage_settings'))
    .use(httpErrorMiddleware()),
);
