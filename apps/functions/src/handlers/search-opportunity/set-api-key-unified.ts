/**
 * Unified set-api-key handler.
 * POST /search-opportunities/api-key
 *
 * Body: { source: 'SAM_GOV' | 'DIBBS', orgId, apiKey }
 */
import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { z } from 'zod';

import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { storeApiKey } from '@/helpers/api-key-storage';
import { SAM_GOV_SECRET_PREFIX } from '@/constants/samgov';
import { DIBBS_SECRET_PREFIX } from '@/constants/dibbs';

const BodySchema = z.object({
  source: z.enum(['SAM_GOV', 'DIBBS']),
  orgId:  z.string().min(1),
  apiKey: z.string().min(1),
});

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) return apiResponse(400, { message: 'Request body is required' });
  let raw: unknown;
  try { raw = JSON.parse(event.body); } catch { return apiResponse(400, { message: 'Invalid JSON body' }); }

  const { success, data, error } = BodySchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Validation error', issues: error.issues });

  const prefix = data.source === 'SAM_GOV' ? SAM_GOV_SECRET_PREFIX : DIBBS_SECRET_PREFIX;
  await storeApiKey(data.orgId, prefix, data.apiKey);
  return apiResponse(200, { ok: true, source: data.source, orgId: data.orgId });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:manage_settings'))
    .use(httpErrorMiddleware()),
);
