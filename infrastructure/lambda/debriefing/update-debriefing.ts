import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';

import { type UpdateDebriefingRequest, UpdateDebriefingRequestSchema, } from '@auto-rfp/shared';
import { PK_NAME, SK_NAME } from '../constants/common';
import { DEBRIEFING_PK } from '../constants/organization';
import { apiResponse } from '../helpers/api';
import { withSentryLambda } from '../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '../middleware/rbac-middleware';
import { requireEnv } from '../helpers/env';
import { docClient } from '../helpers/db';
import type { DBDebriefingItem } from '../types/project-outcome';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
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
    const existing = await getDebriefing(dto.orgId, dto.projectId, dto.debriefingId);
    if (!existing) {
      return apiResponse(404, { message: 'Debriefing not found' });
    }

    const updatedDebriefing = await updateDebriefing(dto, existing);

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
    orgId,
    projectId,
    debriefingId,
    status,
    scheduledDate,
    completedDate,
    findings,
    lessonsLearned,
    actionItems,
    attendees,
    notes
  } = dto;
  const now = new Date().toISOString();
  const sortKey = `${orgId}#${projectId}#${debriefingId}`;

  // Build update expression dynamically
  const updateParts: string[] = [];
  const expressionValues: Record<string, unknown> = {};
  const expressionNames: Record<string, string> = {};

  if (status !== undefined) {
    updateParts.push('#status = :status');
    expressionNames['#status'] = 'status';
    expressionValues[':status'] = status;
  }

  if (scheduledDate !== undefined) {
    updateParts.push('scheduledDate = :scheduledDate');
    expressionValues[':scheduledDate'] = scheduledDate;
  }

  if (completedDate !== undefined) {
    updateParts.push('completedDate = :completedDate');
    expressionValues[':completedDate'] = completedDate;
  }

  if (findings !== undefined) {
    updateParts.push('findings = :findings');
    expressionValues[':findings'] = findings;
  }

  if (lessonsLearned !== undefined) {
    updateParts.push('lessonsLearned = :lessonsLearned');
    expressionValues[':lessonsLearned'] = lessonsLearned;
  }

  if (actionItems !== undefined) {
    updateParts.push('actionItems = :actionItems');
    expressionValues[':actionItems'] = actionItems;
  }

  if (attendees !== undefined) {
    updateParts.push('attendees = :attendees');
    expressionValues[':attendees'] = attendees;
  }

  if (notes !== undefined) {
    updateParts.push('notes = :notes');
    expressionValues[':notes'] = notes;
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
    .use(httpErrorMiddleware())
);
