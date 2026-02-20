import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import middy from '@middy/core';
import { CreateCommentDTOSchema } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { createComment } from '@/helpers/collaboration';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const raw = JSON.parse(event.body ?? '{}') as unknown;
  const { success, data, error } = CreateCommentDTOSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  // orgId comes from the request body — the client always sends it
  const orgId = data.orgId ?? event.queryStringParameters?.orgId;
  const userId = event.auth?.userId;
  const claims = event.auth?.claims ?? {};

  // Build display name from Cognito claims: prefer full name, fall back to email, then userId
  const firstName = (claims['given_name'] as string | undefined) ?? '';
  const lastName = (claims['family_name'] as string | undefined) ?? '';
  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();
  const displayName =
    fullName ||
    (claims['name'] as string | undefined) ||
    (claims['email'] as string | undefined) ||
    userId ||
    'Unknown';

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!userId) return apiResponse(401, { message: 'Unauthorized' });

  const item = await createComment(orgId, {
    commentId: uuidv4(),
    projectId: data.projectId,
    orgId,
    entityType: data.entityType,
    entityId: data.entityId,
    entityPk: data.entityPk,
    entitySk: data.entitySk,
    parentCommentId: data.parentCommentId,
    userId,
    displayName,
    content: data.content,
    mentions: data.mentions,
    resolved: false,
  });

  return apiResponse(201, item);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('answer:read'))
    .use(httpErrorMiddleware()),
);
