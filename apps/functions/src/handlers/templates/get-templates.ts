import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '../../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
} from '@/middleware/rbac-middleware';
import { listTemplatesByOrg } from '@/helpers/template';

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const params = event.queryStringParameters ?? {};
    const category = params.category;
    const status = params.status;
    const limit = params.limit ? parseInt(params.limit, 10) : 20;
    const offset = params.offset ? parseInt(params.offset, 10) : 0;

    const { items, total } = await listTemplatesByOrg(orgId, {
      category,
      status,
      excludeArchived: params.excludeArchived !== 'false',
      limit,
      offset,
    });

    return apiResponse(200, {
      items,
      total,
      limit,
      offset,
      hasMore: offset + limit < total,
    });
  } catch (err) {
    console.error('Error listing templates:', err);
    return apiResponse(500, {
      error: 'Internal server error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(httpErrorMiddleware()),
);