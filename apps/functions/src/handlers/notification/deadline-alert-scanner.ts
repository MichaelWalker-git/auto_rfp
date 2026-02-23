import type { ScheduledHandler } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { queryBySkPrefix } from '@/helpers/db';
import { requireEnv } from '@/helpers/env';
import type { NotificationPayload } from '@auto-rfp/core';

// Deadline entity shape (minimal — only fields we need)
interface DeadlineItem {
  projectId: string;
  orgId: string;
  deadlineAt: string;
  title: string;
  memberUserIds?: string[];
  memberEmails?: string[];
}

const sqs = new SQSClient({});
const NOTIFICATION_QUEUE_URL = requireEnv('NOTIFICATION_QUEUE_URL');
const DEADLINE_PK = 'DEADLINE';

const ALERT_WINDOWS_MS = [
  { label: 'DEADLINE_7_DAYS' as const, ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'DEADLINE_3_DAYS' as const, ms: 3 * 24 * 60 * 60 * 1000 },
  { label: 'DEADLINE_1_DAY' as const, ms: 1 * 24 * 60 * 60 * 1000 },
  { label: 'DEADLINE_6_HOURS' as const, ms: 6 * 60 * 60 * 1000 },
];

export const handler: ScheduledHandler = async () => {
  const now = Date.now();

  // Scan all deadlines — in production scope this by org or use GSI
  const deadlines = await queryBySkPrefix<DeadlineItem>(DEADLINE_PK, '');

  for (const deadline of deadlines) {
    const deadlineMs = new Date(deadline.deadlineAt).getTime();
    const remaining = deadlineMs - now;

    for (const window of ALERT_WINDOWS_MS) {
      // Fire if remaining is within ±30 minutes of the window
      const diff = Math.abs(remaining - window.ms);
      if (diff > 30 * 60 * 1000) continue;

      const payload: NotificationPayload = {
        type: window.label,
        title: `Deadline Alert: ${deadline.title}`,
        message: `The deadline for "${deadline.title}" is approaching.`,
        link: `/projects/${deadline.projectId}`,
        recipientUserIds: deadline.memberUserIds ?? [],
        recipientEmails: deadline.memberEmails ?? [],
        orgId: deadline.orgId,
        projectId: deadline.projectId,
      };

      await sqs.send(
        new SendMessageCommand({
          QueueUrl: NOTIFICATION_QUEUE_URL,
          MessageBody: JSON.stringify(payload),
        }),
      );
    }
  }
};
