import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { z } from 'zod';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';

import { PK_NAME, SK_NAME } from '@/constants/common';
import { withSentryLambda } from '@/sentry-lambda';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME!;

const RequestSchema = z.object({
  orgId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  deadlineType: z.enum(['all', 'submission', 'questions', 'site-visit']).optional(),
});

// ---------------------------
// Helpers
// ---------------------------

/**
 * Generate iCalendar (.ics) format
 */
function generateICS(events: Array<{
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  location?: string;
  url?: string;
  alarms?: number[]; // Minutes before event
}>): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AutoRFP//Deadline Calendar//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:RFP Deadlines',
    'X-WR-TIMEZONE:UTC',
    'X-WR-CALDESC:Deadlines for RFP proposals',
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

    // Add alarms (reminders)
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

/**
 * Format date for iCalendar (YYYYMMDDTHHMMSSZ)
 */
function formatICSDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Escape special characters for iCalendar text fields
 */
function escapeICSText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

/**
 * Query deadlines from DEADLINE table
 */
async function queryDeadlines(
  orgId?: string,
  projectId?: string
): Promise<any[]> {
  let keyConditionExpression = `#pk = :pk`;
  const expressionAttributeValues: any = {
    ':pk': 'DEADLINE',
  };
  const expressionAttributeNames: any = {
    '#pk': PK_NAME,
  };

  if (orgId && projectId) {
    keyConditionExpression += ' AND #sk = :sk';
    expressionAttributeNames['#sk'] = SK_NAME;
    expressionAttributeValues[':sk'] = `${orgId}#${projectId}`;
  } else if (orgId) {
    keyConditionExpression += ' AND begins_with(#sk, :orgPrefix)';
    expressionAttributeNames['#sk'] = SK_NAME;
    expressionAttributeValues[':orgPrefix'] = `${orgId}#`;
  }

  const result = await ddb.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
    })
  );

  let items = result.Items || [];

  // If only projectId provided, filter client-side
  if (projectId && !orgId) {
    items = items.filter(item => item.projectId === projectId);
  }

  return items;
}

/**
 * Convert deadline items to calendar events
 */
function deadlinesToEvents(
  deadlineItems: any[],
  deadlineType: string = 'all'
): Array<{
  summary: string;
  description?: string;
  start: Date;
  end: Date;
  location?: string;
  url?: string;
  alarms?: number[];
}> {
  const events: any[] = [];
  const baseUrl = process.env.FRONTEND_URL;

  deadlineItems.forEach((item) => {
    const projectName = item.projectName || 'Untitled Project';
    const projectUrl = `${baseUrl}/projects/${item.projectId}`;

    // Add submission deadline
    if ((deadlineType === 'all' || deadlineType === 'submission') && item.submissionDeadlineIso) {
      const startDate = new Date(item.submissionDeadlineIso);
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour duration
      const description = [
        `Proposal submission deadline for ${projectName}.`,
        '',
        '⚠️ RECOMMENDED: Submit 24 hours early to avoid last-minute issues.'
      ].join('\n');

      events.push({
        summary: `🔴 Proposal Due: ${projectName}`,
        description,
        start: startDate,
        end: endDate,
        url: projectUrl,
        alarms: [
          24 * 60,      // 1 day before
          60,           // 1 hour before
        ],
      });
    }

    // If only submission deadlines requested, skip the rest
    if (deadlineType === 'submission') return;

    // Add other deadlines
    item.deadlines?.forEach((deadline: any) => {
      if (!deadline.dateTimeIso) return;

      // Filter by type if specified
      if (deadlineType !== 'all') {
        // Skip PROPOSAL_DUE type since we already added submission deadline above
        if (deadline.type === 'PROPOSAL_DUE' || deadline.type?.includes('proposal submission')) return;
        if (deadlineType === 'questions' && deadline.type !== 'QUESTIONS_DUE') return;
        if (deadlineType === 'site-visit' && deadline.type !== 'SITE_VISIT') return;
      }

      const startDate = new Date(deadline.dateTimeIso);
      const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);

      const icon = deadline.type === 'QUESTIONS_DUE' ? '❓' : 
                   deadline.type === 'SITE_VISIT' ? '📍' : '📅';

      const description = [
        deadline.label || deadline.type,
        `Project: ${projectName}`,
        deadline.notes ? `Notes: ${deadline.notes}` : '',
        deadline.timezone ? `Timezone: ${deadline.timezone}` : '',
      ].filter(Boolean).join('\n');

      events.push({
        summary: `${icon} ${deadline.label || deadline.type}: ${projectName}`,
        description,
        start: startDate,
        end: endDate,
        location: deadline.type === 'SITE_VISIT' ? (deadline.location || 'TBD') : undefined,
        url: projectUrl,
        alarms: [24 * 60, 60],
      });
    });
  });

  // Sort events by date
  events.sort((a, b) => a.start.getTime() - b.start.getTime());

  return events;
}

// ---------------------------
// Handler
// ---------------------------

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const params = event.queryStringParameters || {};
    const { orgId, projectId, deadlineType } = RequestSchema.parse(params);

    // Query deadlines
    const deadlineItems = await queryDeadlines(orgId, projectId);

    if (deadlineItems.length === 0) {
      return {
        statusCode: 404,
        headers: { 
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': 'true', 
        },
        body: 'No deadlines found',
      };
    }

    // Convert to calendar events
    const events = deadlinesToEvents(deadlineItems, deadlineType || 'all');

    if (events.length === 0) {
      return {
        statusCode: 404,
        headers: { 
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Credentials': 'true', 
        },
        body: 'No deadlines matching criteria',
      };
    }

    // Generate .ics file
    const icsContent = generateICS(events);

    // Generate filename
    const scope = projectId ? `project-${projectId}` : 
                  orgId ? `org-${orgId}` : 
                  'all-deadlines';
    const type = deadlineType && deadlineType !== 'all' ? `-${deadlineType}` : '';
    const filename = `rfp-deadlines-${scope}${type}.ics`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-cache',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Credentials': 'true',
      },
      body: icsContent,
    };

  } catch (err) {
    console.error('export-calendar error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: err instanceof Error ? err.message : 'Unknown error',
      }),
    };
  }
};

export const handler = withSentryLambda(baseHandler);