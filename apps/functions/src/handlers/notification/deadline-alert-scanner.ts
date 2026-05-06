import type { ScheduledHandler } from 'aws-lambda';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { queryByPk } from '@/helpers/db';
import { PK_NAME } from '@/constants/common';
import { requireEnv } from '@/helpers/env';
import type { NotificationPayload } from '@auto-rfp/core';
import { withSentryLambda } from '@/sentry-lambda';

// Deadline entity shape (minimal — only fields we need)
interface DeadlineItem {
  projectId: string;
  orgId: string;
  deadlineAt: string;
  title: string;
  memberUserIds?: string[];
  memberEmails?: string[];
}

interface OpportunityItem {
  orgId?: string;
  projectId?: string;
  oppId?: string;
  id: string;
  title: string;
  decisionDateIso?: string | null;
  contractStartDateIso?: string | null;
  assigneeId?: string | null;
}

const sqs = new SQSClient({});
const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const DB_TABLE_NAME = process.env.DB_TABLE_NAME!;
const NOTIFICATION_QUEUE_URL = requireEnv('NOTIFICATION_QUEUE_URL');
const DEADLINE_PK = 'DEADLINE';

const ALERT_WINDOWS_MS = [
  { label: 'DEADLINE_7_DAYS' as const, ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'DEADLINE_3_DAYS' as const, ms: 3 * 24 * 60 * 60 * 1000 },
  { label: 'DEADLINE_1_DAY' as const, ms: 1 * 24 * 60 * 60 * 1000 },
  { label: 'DEADLINE_6_HOURS' as const, ms: 6 * 60 * 60 * 1000 },
];

const DECISION_DATE_WINDOWS_MS = [
  { label: 'DECISION_DATE_7_DAYS' as const, ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'DECISION_DATE_3_DAYS' as const, ms: 3 * 24 * 60 * 60 * 1000 },
  { label: 'DECISION_DATE_1_DAY' as const, ms: 1 * 24 * 60 * 60 * 1000 },
];

const baseHandler: ScheduledHandler = async () => {
  const now = Date.now();

  // Scan all deadlines — in production scope this by org or use GSI
  const deadlines = await queryByPk<DeadlineItem>(DEADLINE_PK);

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

  // Query opportunities that have a decision date or contract start date set
  const oppResult = await ddb.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk',
      FilterExpression: 'attribute_exists(#dd) OR attribute_exists(#cs)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#dd': 'decisionDateIso',
        '#cs': 'contractStartDateIso',
      },
      ExpressionAttributeValues: { ':pk': 'OPPORTUNITY' },
    }),
  );
  const opportunities = (oppResult.Items ?? []) as OpportunityItem[];

  for (const opp of opportunities) {
    const dateIso = opp.decisionDateIso || opp.contractStartDateIso;
    if (!dateIso || !opp.orgId) continue;

    const dateMs = new Date(dateIso).getTime();
    const remaining = dateMs - now;
    if (remaining < 0) continue;

    const dateLabel = opp.decisionDateIso ? 'Decision Date' : 'Contract Start Date';

    for (const window of DECISION_DATE_WINDOWS_MS) {
      const diff = Math.abs(remaining - window.ms);
      if (diff > 30 * 60 * 1000) continue;

      const recipientUserIds: string[] = opp.assigneeId ? [opp.assigneeId] : [];

      const payload: NotificationPayload = {
        type: window.label,
        title: `${dateLabel} Approaching: ${opp.title}`,
        message: `The ${dateLabel.toLowerCase()} for "${opp.title}" is approaching.`,
        recipientUserIds,
        recipientEmails: [],
        orgId: opp.orgId,
        projectId: opp.projectId,
        entityId: opp.oppId ?? opp.id,
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

export const handler = withSentryLambda(baseHandler);
