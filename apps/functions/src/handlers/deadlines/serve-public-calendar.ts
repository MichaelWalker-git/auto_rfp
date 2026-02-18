import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { withSentryLambda } from '@/sentry-lambda';
import { PK_NAME, SK_NAME } from '@/constants/common';
import {
  validateSubscriptionToken,
  generateICS,
  deadlinesToCalendarEvents,
} from '@/helpers/calendar-subscription';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

const DB_TABLE_NAME = process.env.DB_TABLE_NAME!;
const FRONTEND_URL = process.env.FRONTEND_URL || '';

async function getOrganizationName(orgId: string): Promise<string> {
  try {
    const result = await ddb.send(
      new GetCommand({
        TableName: DB_TABLE_NAME,
        Key: {
          [PK_NAME]: 'ORG',
          [SK_NAME]: orgId,
        },
        ProjectionExpression: '#name',
        ExpressionAttributeNames: { '#name': 'name' },
      })
    );
    return result.Item?.name || 'Organization';
  } catch (err) {
    console.error('Error fetching org name:', err);
    return 'Organization';
  }
}

async function queryDeadlines(orgId: string): Promise<any[]> {
  const result = await ddb.send(
    new QueryCommand({
      TableName: DB_TABLE_NAME,
      KeyConditionExpression: '#pk = :pk AND begins_with(#sk, :orgPrefix)',
      ExpressionAttributeNames: {
        '#pk': PK_NAME,
        '#sk': SK_NAME,
      },
      ExpressionAttributeValues: {
        ':pk': 'DEADLINE',
        ':orgPrefix': `${orgId}#`,
      },
    })
  );

  return result.Items || [];
}

const baseHandler = async (
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyResultV2> => {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle OPTIONS preflight 
  const httpMethod = (event as any).httpMethod || event.requestContext?.http?.method;
  if (httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: corsHeaders, body: '' };
  }

  try {
    const orgId = event.pathParameters?.orgId;
    const token = event.queryStringParameters?.token;

    if (!orgId) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
        body: 'Missing organization ID',
      };
    }

    if (!token) {
      return {
        statusCode: 401,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
        body: 'Missing subscription token',
      };
    }

    // Validate token
    const isValid = await validateSubscriptionToken(orgId, token);
    if (!isValid) {
      return {
        statusCode: 403,
        headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
        body: 'Invalid or expired subscription token',
      };
    }

    // Query deadlines and org name for this organization
    const [deadlineItems, orgName] = await Promise.all([
      queryDeadlines(orgId),
      getOrganizationName(orgId),
    ]);

    // Convert to events and generate ICS with org name
    const calendarName = `${orgName} Deadlines`;
    const events = deadlinesToCalendarEvents(deadlineItems, FRONTEND_URL);
    const icsContent = generateICS(events, calendarName);

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders,
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'max-age=3600, must-revalidate',
      },
      body: icsContent,
    };

  } catch (err) {
    console.error('serve-public-calendar error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'text/plain' },
      body: 'Internal server error',
    };
  }
};

export const handler = withSentryLambda(baseHandler);