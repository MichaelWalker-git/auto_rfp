import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import { getExtractionJobRecord } from '@/helpers/extraction';
import { apiResponse } from '@/helpers/api';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId, jobId } = event.queryStringParameters || {};

  if (!orgId || !jobId) {
    return apiResponse(400, { ok: false, error: 'orgId and jobId are required' });
  }

  const job = await getExtractionJobRecord(orgId, jobId);

  if (!job) {
    return apiResponse(404, { ok: false, error: 'Extraction job not found' });
  }

  return apiResponse(200, { ok: true, job });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('kb:read'))
    .use(httpErrorMiddleware()),
);
