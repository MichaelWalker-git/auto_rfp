import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { apiResponse, getOrgId, getUserId } from '../helpers/api';
import { listKnowledgeBasesForOrg } from '../helpers/kb';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';
import middy from '@middy/core';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const tokenOrgId = getOrgId(event);
    const { orgId: queryOrgId } = event.queryStringParameters || {};
    const orgId = tokenOrgId || queryOrgId;

    if (!orgId) {
      return apiResponse(400, { message: 'Missing required parameter: orgId' });
    }

    const userId = getUserId(event);
    const knowledgeBases = await listKnowledgeBasesForOrg(orgId, userId);

    return apiResponse(200, knowledgeBases);
  } catch (err) {
    console.error('Error in getKnowledgeBases handler:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('kb:read'))
    .use(httpErrorMiddleware()),
);