import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { requireEnv } from '@/helpers/env';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
} from '@/middleware/rbac-middleware';
import { generateStaleReport } from './stale-content.service';

const TABLE_NAME = requireEnv('DB_TABLE_NAME');

/**
 * GET /content-library/stale-report?orgId=&kbId=
 * Returns freshness summary for both Content Library items AND KB Documents.
 * Delegates all business logic to stale-content.service.ts.
 */
async function baseHandler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> {
  const params = event.queryStringParameters || {};
  const orgId = params.orgId || getOrgId(event);
  const kbId = params.kbId;

  if (!orgId || !kbId) {
    return apiResponse(400, { error: 'orgId and kbId are required' });
  }

  try {
    const report = await generateStaleReport(TABLE_NAME, orgId, kbId);
    return apiResponse(200, report);
  } catch (error) {
    console.error('Error generating stale content report:', error);
    return apiResponse(500, { error: 'Failed to generate stale content report' });
  }
}

export const handler = middy(withSentryLambda(baseHandler))
  .use(httpErrorMiddleware())
  .use(authContextMiddleware())
  .use(orgMembershipMiddleware());
