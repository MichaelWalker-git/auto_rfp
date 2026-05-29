import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import type { NotificationPayload, NotificationType } from '@auto-rfp/core';

const sqs = new SQSClient({});
const NOTIFICATION_QUEUE_URL = process.env['NOTIFICATION_QUEUE_URL'];

/**
 * Enqueue a notification to the SQS notification queue.
 * Best-effort — never throws; logs errors instead.
 *
 * NOTE: Do NOT set `link` in the payload — the frontend constructs
 * the destination URL from `type` + `orgId` + `projectId`.
 */
export const sendNotification = async (payload: NotificationPayload): Promise<void> => {
  if (!NOTIFICATION_QUEUE_URL) {
    console.warn('NOTIFICATION_QUEUE_URL not set — skipping notification', payload.type);
    return;
  }
  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: NOTIFICATION_QUEUE_URL,
        MessageBody: JSON.stringify(payload),
      }),
    );
  } catch (err) {
    console.error('Failed to enqueue notification:', err);
  }
};

/**
 * Build a notification payload.
 * Do NOT pass `link` — the frontend constructs the URL from type + orgId + projectId.
 */
export const buildNotification = (
  type: NotificationType,
  title: string,
  message: string,
  opts: {
    orgId: string;
    projectId?: string;
    /** Optional entity ID for deep-linking (e.g. questionId for MENTION) */
    entityId?: string;
    recipientUserIds: string[];
    recipientEmails?: string[];
    actorDisplayName?: string;
  },
): NotificationPayload => ({
  type,
  title,
  message,
  recipientUserIds: opts.recipientUserIds,
  recipientEmails: opts.recipientEmails ?? [],
  orgId: opts.orgId,
  projectId: opts.projectId,
  entityId: opts.entityId,
  actorDisplayName: opts.actorDisplayName,
});
