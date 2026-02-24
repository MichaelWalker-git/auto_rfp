import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';

import { type UpdateDebriefingRequest, UpdateDebriefingRequestSchema, } from '@auto-rfp/core';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { DEBRIEFING_PK } from '@/constants/organization';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import type { DBDebriefingItem } from '@/types/project-outcome';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const { orgId, projectId, debriefingId } = event.queryStringParameters || {};

    if (!orgId || !projectId || !debriefingId) {
      return apiResponse(400, {
        message: 'Missing required query parameters: orgId, projectId, debriefingId',
      });
    }

    const rawBody = JSON.parse(event.body);
    const validationResult = UpdateDebriefingRequestSchema.safeParse(rawBody);

    if (!validationResult.success) {
      const errorDetails = validationResult.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const dto: UpdateDebriefingRequest = validationResult.data;

    // Verify debriefing exists
    const existing = await getDebriefing(orgId, projectId, debriefingId);
    if (!existing) {
      return apiResponse(404, { message: 'Debriefing not found' });
    }

    const updatedDebriefing = await updateDebriefing(dto, existing);

    
    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: event.pathParameters?.debriefingId ?? 'unknown',
    });

    return apiResponse(200, { debriefing: updatedDebriefing });
  } catch (err: unknown) {
    console.error('Error in updateDebriefing handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

async function getDebriefing(
  orgId: string,
  projectId: string,
  debriefingId: string
): Promise<DBDebriefingItem | null> {
  const sortKey = `${orgId}#${projectId}#${debriefingId}`;

  const cmd = new GetCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: DEBRIEFING_PK,
      [SK_NAME]: sortKey,
    },
  });

  const result = await docClient.send(cmd);
  return result.Item as DBDebriefingItem | null;
}

export async function updateDebriefing(
  dto: UpdateDebriefingRequest,
  existing: DBDebriefingItem
): Promise<DBDebriefingItem> {
  const {
    requestStatus,
    requestSentDate,
    requestMethod,
    scheduledDate,
    locationType,
    location,
    meetingLink,
    attendees,
    notes,
    strengthsIdentified,
    weaknessesIdentified,
    evaluationScores,
    keyTakeaways
  } = dto;
  const now = new Date().toISOString();
  const sortKey = existing[SK_NAME] as string;

  // Build update expression dynamically
  const updateParts: string[] = [];
  const expressionValues: Record<string, unknown> = {};
  const expressionNames: Record<string, string> = {};

  if (requestStatus !== undefined) {
    updateParts.push('#requestStatus = :requestStatus');
    expressionNames['#requestStatus'] = 'requestStatus';
    expressionValues[':requestStatus'] = requestStatus;
  }

  if (requestSentDate !== undefined) {
    updateParts.push('requestSentDate = :requestSentDate');
    expressionValues[':requestSentDate'] = requestSentDate;
  }

  if (requestMethod !== undefined) {
    updateParts.push('requestMethod = :requestMethod');
    expressionValues[':requestMethod'] = requestMethod;
  }

  if (scheduledDate !== undefined) {
    updateParts.push('scheduledDate = :scheduledDate');
    expressionValues[':scheduledDate'] = scheduledDate;
  }

  if (locationType !== undefined) {
    updateParts.push('locationType = :locationType');
    expressionValues[':locationType'] = locationType;
  }

  if (location !== undefined) {
    updateParts.push('location = :location');
    expressionValues[':location'] = location;
  }

  if (meetingLink !== undefined) {
    updateParts.push('meetingLink = :meetingLink');
    expressionValues[':meetingLink'] = meetingLink;
  }

  if (attendees !== undefined) {
    updateParts.push('attendees = :attendees');
    expressionValues[':attendees'] = attendees;
  }

  if (notes !== undefined) {
    updateParts.push('notes = :notes');
    expressionValues[':notes'] = notes;
  }

  if (strengthsIdentified !== undefined) {
    updateParts.push('strengthsIdentified = :strengthsIdentified');
    expressionValues[':strengthsIdentified'] = strengthsIdentified;
  }

  if (weaknessesIdentified !== undefined) {
    updateParts.push('weaknessesIdentified = :weaknessesIdentified');
    expressionValues[':weaknessesIdentified'] = weaknessesIdentified;
  }

  if (evaluationScores !== undefined) {
    updateParts.push('evaluationScores = :evaluationScores');
    expressionValues[':evaluationScores'] = evaluationScores;
  }

  if (keyTakeaways !== undefined) {
    updateParts.push('keyTakeaways = :keyTakeaways');
    expressionValues[':keyTakeaways'] = keyTakeaways;
  }

  // Always update updatedAt
  updateParts.push('updatedAt = :updatedAt');
  expressionValues[':updatedAt'] = now;

  const cmd = new UpdateCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: DEBRIEFING_PK,
      [SK_NAME]: sortKey,
    },
    UpdateExpression: `SET ${updateParts.join(', ')}`,
    ExpressionAttributeValues: expressionValues,
    ...(Object.keys(expressionNames).length > 0 && { ExpressionAttributeNames: expressionNames }),
    ReturnValues: 'ALL_NEW',
  });

  const result = await docClient.send(cmd);

  return result.Attributes as DBDebriefingItem;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
