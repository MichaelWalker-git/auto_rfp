import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { UpdateCommentDTOSchema } from '@auto-rfp/core';
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

  const raw = JSON.parse(event.body ?? '{}') as unknown;
  const { success, data, error } = UpdateCommentDTOSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  const orgId = event.queryStringParameters?.orgId;
  const entityType = event.queryStringParameters?.entityType;
  const entityId = event.queryStringParameters?.entityId;

  if (!orgId) return apiResponse(400, { message: 'orgId is required' });
  if (!entityType) return apiResponse(400, { message: 'entityType is required' });
  if (!entityId) return apiResponse(400, { message: 'entityId is required' });

  const userId = event.auth?.userId;
  if (!userId) return apiResponse(401, { message: 'Unauthorized' });

  const updates: Partial<CommentItem> = {};
  if (data.content !== undefined) updates.content = data.content;
  if (data.resolved !== undefined) {
    updates.resolved = data.resolved;
    if (data.resolved) {
      updates.resolvedBy = userId;
      updates.resolvedAt = new Date().toISOString();
    } else {
      updates.resolvedBy = undefined;
      updates.resolvedAt = undefined;
    }
  }

  const updated = await updateItem<CommentItem>(
    PK.COMMENT,
    buildCommentSK(orgId, data.projectId, entityType, entityId, commentId),
    updates,
  );

  
    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: event.pathParameters?.commentId ?? 'unknown',
    });

    return apiResponse(200, updated);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('answer:read'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
