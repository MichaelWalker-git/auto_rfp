import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import middy from '@middy/core';
import { CreateKnowledgeBaseSchema, } from '@auto-rfp/core';

import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { createKnowledgeBase } from '@/helpers/kb';
import { grantKBAccess } from '@/helpers/user-kb';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '@/middleware/rbac-middleware';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const tokenOrgId = getOrgId(event);
  const { orgId: queryOrgId } = event.queryStringParameters || {};

  const orgId = tokenOrgId ? tokenOrgId : queryOrgId;

  if (!orgId) throw new Error('No orgId provided');

  try {
    const rawBody = JSON.parse(event.body || '');
    const { success, data, error: errors } = CreateKnowledgeBaseSchema.safeParse(rawBody);

    if (!success) {
      const errorDetails = errors.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const created = await createKnowledgeBase(orgId, data);

    // Auto-grant the creating user access to the new KB
    const userId = getUserId(event);
    if (userId && created.id) {
      try {
        await grantKBAccess(orgId, userId, created.id, 'admin', userId);
        console.log(`Auto-granted KB access to creator ${userId} for KB ${created.id}`);
      } catch (accessErr) {
        // Log but don't fail the KB creation
        console.warn('Failed to auto-grant KB access to creator:', (accessErr as Error)?.message);
      }
    }

    return apiResponse(201, created);
  } catch (err) {
    console.error('Error in createKnowledgeBase handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

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
    .use(requirePermission('kb:create'))
    .use(httpErrorMiddleware())
);
