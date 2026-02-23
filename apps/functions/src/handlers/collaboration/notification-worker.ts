import type { SQSHandler } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { v4 as uuidv4 } from 'uuid';
import { requireEnv } from '@/helpers/env';
import { createNotification, getNotificationPreferences } from '@/helpers/notification';
import type { NotificationPayload } from '@auto-rfp/core';

const ses = new SESClient({});
const FROM_EMAIL = requireEnv('NOTIFICATION_FROM_EMAIL');
const APP_URL = process.env['APP_URL'] ?? 'https://app.auto-rfp.com';

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    const payload = JSON.parse(record.body) as NotificationPayload;
    await processNotification(payload);
  }
};

const processNotification = async (payload: NotificationPayload): Promise<void> => {
  const { recipientUserIds, recipientEmails = [], orgId, type, title, message, link, projectId } = payload;

  // 1. Persist in-app notification for each recipient
  await Promise.all(
    recipientUserIds.map(async (userId) => {
      const prefs = await getNotificationPreferences(orgId, userId);
      const inAppEnabled = prefs?.inApp ?? true;
      const typeEnabled = prefs?.typeOverrides?.[type] ?? true;

      if (!inAppEnabled || !typeEnabled) return;

      await createNotification({
        notificationId: uuidv4(),
        userId,
        orgId,
        type,
        title,
        message,
        link,
        read: false,
        archived: false,
        channels: ['in_app'],
        projectId,
        entityId: payload.entityId,
      });
    }),
  );

  // 2. Send email to recipients who have email enabled (opt-in — off by default)
  const emailsToSend: string[] = [];
  for (let i = 0; i < recipientUserIds.length; i++) {
    const userId = recipientUserIds[i];
    if (!userId) continue;
    const prefs = await getNotificationPreferences(orgId, userId);
    const emailEnabled = prefs?.email ?? false; // email is opt-in — off by default
    const typeEnabled = prefs?.typeOverrides?.[type] ?? true;
    if (emailEnabled && typeEnabled && recipientEmails[i]) {
      emailsToSend.push(recipientEmails[i]!);
    }
  }

  for (const email of emailsToSend) {
    await ses.send(
      new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: title },
          Body: {
            Html: {
              Data: buildEmailBody({ title, message, link }),
            },
          },
        },
      }),
    );
  }
};

const buildEmailBody = ({
  title,
  message,
  link,
}: {
  title: string;
  message: string;
  link?: string;
}): string => `
  <html><body style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
    <h2>${title}</h2>
    <p>${message}</p>
    ${link ? `<p><a href="${APP_URL}${link}" style="background:#4f46e5;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">View in AutoRFP</a></p>` : ''}
    <hr/>
    <p style="color:#888;font-size:12px;">You received this because you are a member of this project. Manage your notification preferences in AutoRFP settings.</p>
  </body></html>
`;
