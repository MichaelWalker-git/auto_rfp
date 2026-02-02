import { APIGatewayProxyEventV2, APIGatewayProxyResultV2, } from 'aws-lambda';
import { apiResponse, getOrgId } from '../helpers/api';
import { CreateKnowledgeBaseSchema, } from '@auto-rfp/shared';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission
} from '../middleware/rbac-middleware';
import middy from '@middy/core';
import { createKnowledgeBase } from '../helpers/kb';

export const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const tokenOrgId = getOrgId(event);
  const { orgId: queryOrgId } = event.queryStringParameters || {};

  const orgId = tokenOrgId ? tokenOrgId : queryOrgId;

  if (!orgId) throw new Error('No orgId provided');

  try {
    const rawBody = JSON.parse(event.body || '');
    const { success, data, error } = CreateKnowledgeBaseSchema.safeParse(rawBody);

    if (!success) {
      const errorDetails = error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const created = await createKnowledgeBase(orgId, data);

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
