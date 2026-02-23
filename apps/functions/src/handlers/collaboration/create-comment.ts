import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';
import middy from '@middy/core';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { CreateCommentDTOSchema } from '@auto-rfp/core';
import type { NotificationPayload } from '@auto-rfp/core';
import { apiResponse } from '@/helpers/api';
import { createComment } from '@/helpers/collaboration';
import { getUserByOrgAndId } from '@/helpers/user';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

const sqs = new SQSClient({});
const NOTIFICATION_QUEUE_URL = process.env['NOTIFICATION_QUEUE_URL'];

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

  // ── Enqueue MENTION notifications for each mentioned user ─────────────────
  if (data.mentions.length > 0 && NOTIFICATION_QUEUE_URL) {
    try {
      // Look up emails for mentioned users (best-effort — don't fail the request)
      const mentionedUsers = await Promise.all(
        data.mentions.map((mentionedUserId) => getUserByOrgAndId(orgId, mentionedUserId)),
      );

      const recipientUserIds: string[] = [];
      const recipientEmails: string[] = [];

      for (const user of mentionedUsers) {
        if (user) {
          recipientUserIds.push(user.userId);
          recipientEmails.push(user.email);
        }
      }

      if (recipientUserIds.length > 0) {
        const payload: NotificationPayload = {
          type: 'MENTION',
          title: `${displayName} mentioned you in a comment`,
          message: data.content.slice(0, 200),
          recipientUserIds,
          recipientEmails,
          orgId,
          projectId: data.projectId,
          // entityId = the question/entity being commented on — used for deep-linking
          entityId: data.entityId,
          actorDisplayName: displayName,
        };

        await sqs.send(
          new SendMessageCommand({
            QueueUrl: NOTIFICATION_QUEUE_URL,
            MessageBody: JSON.stringify(payload),
          }),
        );
      }
    } catch (notifErr) {
      // Notification failure must never fail the comment creation
      console.error('Failed to enqueue mention notification:', notifErr);
    }
  }

  
    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: 'comment',
    });

    return apiResponse(201, item);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('answer:read'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
