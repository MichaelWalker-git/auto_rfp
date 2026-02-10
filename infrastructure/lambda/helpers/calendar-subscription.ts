import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import { randomBytes } from 'crypto';
import { PK_NAME, SK_NAME } from '../constants/common';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME!;
export const CALENDAR_SUBSCRIPTION_PK = 'CALENDAR_SUBSCRIPTION';

export interface CalendarSubscription {
  token: string;
  orgId: string;
  createdAt: string;
  createdBy: string;
  regeneratedAt?: string;
}

export function generateSubscriptionToken(): string {
  return randomBytes(32).toString('hex'); // 64 characters
}

export async function getSubscription(orgId: string): Promise<CalendarSubscription | null> {
  const result = await ddb.send(
    new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: CALENDAR_SUBSCRIPTION_PK,
        [SK_NAME]: orgId,
      },
    })
  );
  return (result.Item as CalendarSubscription) || null;
}

export async function createOrUpdateSubscription(
  orgId: string,
  userId: string,
  regenerate = false
): Promise<CalendarSubscription> {
  const existing = await getSubscription(orgId);
  
  if (existing && !regenerate) {
    return existing;
  }

  const token = generateSubscriptionToken();
  const now = new Date().toISOString();

  const subscription: CalendarSubscription = {
    token,
    orgId,
    createdAt: existing?.createdAt || now,
    createdBy: existing?.createdBy || userId,
    regeneratedAt: regenerate ? now : undefined,
  };

  await ddb.send(
    new PutCommand({
      TableName: DB_TABLE_NAME,
      Item: {
        [PK_NAME]: CALENDAR_SUBSCRIPTION_PK,
        [SK_NAME]: orgId,
        ...subscription,
      },
    })
  );

  return subscription;
}

export async function deleteSubscription(orgId: string): Promise<void> {
  await ddb.send(
    new DeleteCommand({
      TableName: DB_TABLE_NAME,
      Key: {
        [PK_NAME]: CALENDAR_SUBSCRIPTION_PK,
        [SK_NAME]: orgId,
      },
    })
  );
}

export async function validateSubscriptionToken(orgId: string, token: string): Promise<boolean> {
  const subscription = await getSubscription(orgId);
  if (!subscription) return false;
  return subscription.token === token;
}

// ---------------------------
// ICS Generation
// ---------------------------

interface CalendarEvent {
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  location?: string;
  url?: string;
  alarms?: number[];
}

export function generateICS(events: CalendarEvent[], calendarName = 'RFP Deadlines'): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AutoRFP//Deadline Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICSText(calendarName)}`,
    'X-WR-TIMEZONE:UTC',
    `X-WR-CALDESC:${escapeICSText(calendarName)} - proposal and RFP deadlines`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
  ];

  events.forEach((event) => {
    const uid = `${event.start.getTime()}-${Math.random().toString(36).substr(2, 9)}@autorfp.com`;
    const now = new Date();
    const dtStamp = formatICSDate(now);
    const dtStart = formatICSDate(event.start);
    const dtEnd = formatICSDate(event.end);

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${uid}`);
    lines.push(`DTSTAMP:${dtStamp}`);
    lines.push(`DTSTART:${dtStart}`);
    lines.push(`DTEND:${dtEnd}`);
    lines.push(`SUMMARY:${escapeICSText(event.summary)}`);
    
    if (event.description) {
      lines.push(`DESCRIPTION:${escapeICSText(event.description)}`);
    }
    
    if (event.location) {
      lines.push(`LOCATION:${escapeICSText(event.location)}`);
    }
    
    if (event.url) {
      lines.push(`URL:${event.url}`);
    }

    if (event.alarms && event.alarms.length > 0) {
      event.alarms.forEach((minutes) => {
        lines.push('BEGIN:VALARM');
        lines.push('ACTION:DISPLAY');
        lines.push(`DESCRIPTION:Reminder: ${event.summary}`);
        lines.push(`TRIGGER:-PT${minutes}M`);
        lines.push('END:VALARM');
      });
    }

    lines.push('END:VEVENT');
  });

  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

function formatICSDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

export function deadlinesToCalendarEvents(
  deadlineItems: any[],
  frontendUrl: string
): CalendarEvent[] {
  const events: CalendarEvent[] = [];

  deadlineItems.forEach((item) => {
    const projectName = item.projectName || 'Untitled Project';
    const projectUrl = `${frontendUrl}/projects/${item.projectId}`;

    if (item.submissionDeadlineIso) {
      const startDate = new Date(item.submissionDeadlineIso);
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
      
      events.push({
        summary: `🔴 Proposal Due: ${projectName}`,
        description: `Proposal submission deadline for ${projectName}.\n\n⚠️ RECOMMENDED: Submit 24 hours early.`,
        start: startDate,
        end: endDate,
        url: projectUrl,
        alarms: [24 * 60, 60],
      });
    }

    item.deadlines?.forEach((deadline: any) => {
      if (!deadline.dateTimeIso) return;

      const startDate = new Date(deadline.dateTimeIso);
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

      const icon = deadline.type === 'QUESTIONS_DUE' ? '❓' : 
                   deadline.type === 'SITE_VISIT' ? '📍' : '📅';

      events.push({
        summary: `${icon} ${deadline.label || deadline.type}: ${projectName}`,
        description: [
          deadline.label || deadline.type,
          `Project: ${projectName}`,
          deadline.notes ? `Notes: ${deadline.notes}` : '',
        ].filter(Boolean).join('\n'),
        start: startDate,
        end: endDate,
        location: deadline.type === 'SITE_VISIT' ? (deadline.location || 'TBD') : undefined,
        url: projectUrl,
        alarms: [24 * 60, 60],
      });
    });
  });

  events.sort((a, b) => a.start.getTime() - b.start.getTime());
  return events;
}