import { APIGatewayProxyResultV2 } from 'aws-lambda';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { listKnowledgeBasesForOrg } from '@/helpers/kb';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import middy from '@middy/core';

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const tokenOrgId = getOrgId(event);
    const { orgId: queryOrgId } = event.queryStringParameters || {};
    const orgId = tokenOrgId || queryOrgId;

    if (!orgId) {
      return apiResponse(400, { message: 'Missing required parameter: orgId' });
    }

    const userId = getUserId(event);
    const isOrgAdmin = event.rbac?.role === 'ADMIN';
    
    // Org admins see all KBs; non-admins see only KBs they have access to
    const knowledgeBases = await listKnowledgeBasesForOrg(orgId, isOrgAdmin ? null : userId);

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