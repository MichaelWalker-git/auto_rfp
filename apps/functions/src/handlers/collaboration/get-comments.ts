import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { CommentEntityTypeSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { listComments } from '@/helpers/collaboration';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId, projectId, entityType, entityId } = event.queryStringParameters ?? {};

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!projectId) return apiResponse(400, { message: 'projectId is required' });
  if (!entityType) return apiResponse(400, { message: 'entityType is required' });
  if (!entityId) return apiResponse(400, { message: 'entityId is required' });

  const { success: typeValid } = CommentEntityTypeSchema.safeParse(entityType);
  if (!typeValid) return apiResponse(400, { message: 'Invalid entityType' });

  const items = await listComments(orgId, projectId, entityType, entityId);

  return apiResponse(200, { items, count: items.length });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('answer:read'))
    .use(httpErrorMiddleware()),
);
