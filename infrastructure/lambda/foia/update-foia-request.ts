import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { UpdateCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';

import {
  UpdateFOIARequestSchema,
  type UpdateFOIARequest,
} from '@auto-rfp/shared';
import { PK_NAME, SK_NAME } from '../constants/common';
import { FOIA_REQUEST_PK } from '../constants/organization';
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
import type { DBFOIARequestItem } from '../types/project-outcome';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);
    const validationResult = UpdateFOIARequestSchema.safeParse(rawBody);

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

    const dto: UpdateFOIARequest = validationResult.data;

    // Verify FOIA request exists
    const existing = await getFOIARequest(dto.orgId, dto.projectId, dto.foiaRequestId);
    if (!existing) {
      return apiResponse(404, { message: 'FOIA request not found' });
    }

    const updatedRequest = await updateFOIARequest(dto, existing);

    return apiResponse(200, { foiaRequest: updatedRequest });
  } catch (err: unknown) {
    console.error('Error in updateFOIARequest handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

async function getFOIARequest(
  orgId: string,
  projectId: string,
  foiaRequestId: string
): Promise<DBFOIARequestItem | null> {
  const sortKey = `${orgId}#${projectId}#${foiaRequestId}`;

  const cmd = new GetCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: FOIA_REQUEST_PK,
      [SK_NAME]: sortKey,
    },
  });

  const result = await docClient.send(cmd);
  return result.Item as DBFOIARequestItem | null;
}

export async function updateFOIARequest(
  dto: UpdateFOIARequest,
  existing: DBFOIARequestItem
): Promise<DBFOIARequestItem> {
  const {
    orgId,
    projectId,
    foiaRequestId,
    status,
    submittedDate,
    responseDate,
    responseNotes,
    receivedDocuments,
    trackingNumber,
    appealDeadline,
    appealDate,
    notes,
  } = dto;

  const now = new Date().toISOString();
  const sortKey = `${orgId}#${projectId}#${foiaRequestId}`;

  // Build update expression dynamically
  const updateParts: string[] = [];
  const expressionValues: Record<string, unknown> = {};
  const expressionNames: Record<string, string> = {};

  if (status !== undefined) {
    updateParts.push('#status = :status');
    expressionNames['#status'] = 'status';
    expressionValues[':status'] = status;
  }

  if (submittedDate !== undefined) {
    updateParts.push('submittedDate = :submittedDate');
    expressionValues[':submittedDate'] = submittedDate;
  }

  if (responseDate !== undefined) {
    updateParts.push('responseDate = :responseDate');
    expressionValues[':responseDate'] = responseDate;
  }

  if (responseNotes !== undefined) {
    updateParts.push('responseNotes = :responseNotes');
    expressionValues[':responseNotes'] = responseNotes;
  }

  if (receivedDocuments !== undefined) {
    updateParts.push('receivedDocuments = :receivedDocuments');
    expressionValues[':receivedDocuments'] = receivedDocuments;
  }

  if (trackingNumber !== undefined) {
    updateParts.push('trackingNumber = :trackingNumber');
    expressionValues[':trackingNumber'] = trackingNumber;
  }

  if (appealDeadline !== undefined) {
    updateParts.push('appealDeadline = :appealDeadline');
    expressionValues[':appealDeadline'] = appealDeadline;
  }

  if (appealDate !== undefined) {
    updateParts.push('appealDate = :appealDate');
    expressionValues[':appealDate'] = appealDate;
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
      [PK_NAME]: FOIA_REQUEST_PK,
      [SK_NAME]: sortKey,
    },
    UpdateExpression: `SET ${updateParts.join(', ')}`,
    ExpressionAttributeValues: expressionValues,
    ...(Object.keys(expressionNames).length > 0 && { ExpressionAttributeNames: expressionNames }),
    ReturnValues: 'ALL_NEW',
  });

  const result = await docClient.send(cmd);

  return result.Attributes as DBFOIARequestItem;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:edit'))
    .use(httpErrorMiddleware())
);
