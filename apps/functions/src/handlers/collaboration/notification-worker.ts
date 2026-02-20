import type { SQSHandler } from 'aws-lambda';
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { requireEnv } from '@/helpers/env';

const ses = new SESClient({});
const FROM_EMAIL = requireEnv('NOTIFICATION_FROM_EMAIL');
const APP_URL = process.env['APP_URL'] ?? 'https://app.auto-rfp.com';

interface NotificationPayload {
  type: 'MENTION' | 'ASSIGNMENT' | 'REPLY';
  commentId?: string;
  projectId: string;
  questionId?: string;
  actorDisplayName: string;
  mentionedUserIds?: string[];
  assignedToUserId?: string;
  assignedToEmail?: string;
  mentionedUserEmails?: string[];
  content?: string;
}

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    const payload = JSON.parse(record.body) as NotificationPayload;
    await processNotification(payload);
  }
};

async function processNotification(payload: NotificationPayload): Promise<void> {
  const recipientEmails: string[] = [];

  if (payload.type === 'MENTION' && payload.mentionedUserEmails) {
    recipientEmails.push(...payload.mentionedUserEmails);
  } else if (payload.type === 'ASSIGNMENT' && payload.assignedToEmail) {
    recipientEmails.push(payload.assignedToEmail);
  }

  if (recipientEmails.length === 0) return;

  const subject = buildSubject(payload);
  const body = buildBody(payload);

  for (const email of recipientEmails) {
    await ses.send(
      new SendEmailCommand({
        Source: FROM_EMAIL,
        Destination: { ToAddresses: [email] },
        Message: {
          Subject: { Data: subject },
          Body: { Html: { Data: body } },
        },
      }),
    );
  }
}

function buildSubject(payload: NotificationPayload): string {
  switch (payload.type) {
    case 'MENTION':
      return `${payload.actorDisplayName} mentioned you in a comment`;
    case 'ASSIGNMENT':
      return `You've been assigned a question`;
    case 'REPLY':
      return `New reply in a thread you follow`;
  }
}

function buildBody(payload: NotificationPayload): string {
  return `
    <html><body>
      <h2>${buildSubject(payload)}</h2>
      <p>${payload.actorDisplayName} ${payload.type === 'MENTION' ? 'mentioned you' : 'assigned you a question'} in project ${payload.projectId}.</p>
      ${payload.content ? `<blockquote>${payload.content}</blockquote>` : ''}
      <p><a href="${APP_URL}/projects/${payload.projectId}">View in AutoRFP</a></p>
    </body></html>
  `;
}
