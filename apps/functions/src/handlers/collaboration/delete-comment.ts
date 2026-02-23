import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { updateItem } from '@/helpers/db';
import { PK } from '@/constants/collaboration';
import { buildCommentSK } from '@/helpers/collaboration';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import type { CommentItem } from '@auto-rfp/core';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const commentId = event.pathParameters?.commentId;
  if (!commentId) return apiResponse(400, { message: 'commentId is required' });

  const { orgId, projectId, entityType, entityId } = event.queryStringParameters ?? {};

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!projectId) return apiResponse(400, { message: 'projectId is required' });
  if (!entityType) return apiResponse(400, { message: 'entityType is required' });
  if (!entityId) return apiResponse(400, { message: 'entityId is required' });

  // Soft delete — set deletedAt timestamp
  await updateItem<CommentItem>(
    PK.COMMENT,
    buildCommentSK(orgId, projectId, entityType, entityId, commentId),
    { deletedAt: new Date().toISOString() },
  );

  
    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: event.pathParameters?.commentId ?? 'unknown',
    });

    return apiResponse(200, { ok: true });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('answer:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
