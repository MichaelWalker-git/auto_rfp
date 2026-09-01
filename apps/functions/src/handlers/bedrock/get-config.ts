/**
 * Read the per-org Bedrock configuration STATUS.
 * GET /bedrock/get-config?orgId=...
 *
 * Returns `{ configured, fallbackModelId, lastProbe }` — NEVER the key itself.
 * `configured` is true when a Bedrock secret exists for the org.
 */
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import type { BedrockConfigStatusResponse } from '@auto-rfp/core';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { getApiKey } from '@/helpers/api-key-storage';
import { getBedrockConfig } from '@/helpers/bedrock-config';
import { BEDROCK_SECRET_PREFIX } from '@/constants/bedrock-config';

export const getBedrockConfigStatus = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  const orgId = event.queryStringParameters?.orgId;
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const [apiKey, config] = await Promise.all([
    getApiKey(orgId, BEDROCK_SECRET_PREFIX),
    getBedrockConfig(orgId),
  ]);

  // Status only — the key is deliberately never included in the response.
  const response: BedrockConfigStatusResponse = {
    configured: Boolean(apiKey),
    fallbackModelId: config?.fallbackModelId,
    lastProbe: config?.lastProbe,
  };

  return apiResponse(200, response);
};

export const handler = withSentryLambda(
  middy(getBedrockConfigStatus)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:read'))
    .use(httpErrorMiddleware()),
);
