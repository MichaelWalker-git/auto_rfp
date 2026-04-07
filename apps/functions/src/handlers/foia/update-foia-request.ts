import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';

import { UpdateFOIARequestSchema } from '@auto-rfp/core';
import type { UpdateFOIARequest } from '@auto-rfp/core';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { FOIA_REQUEST_PK } from '@/constants/organization';
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

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

/** Fields that can be updated (excludes identifiers and metadata) */
const UPDATABLE_FIELDS: (keyof UpdateFOIARequest)[] = [
  'agencyName',
  'agencyFOIAEmail',
  'agencyFOIAAddress',
  'solicitationNumber',
  'contractTitle',
  'requestedDocuments',
  'requesterName',
  'requesterTitle',
  'requesterEmail',
  'requesterPhone',
  'requesterAddress',
  'customDocumentRequests',
  'companyName',
  'awardeeName',
  'awardDate',
  'feeLimit',
];

export const baseHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);
    const { success, data: dto, error } = UpdateFOIARequestSchema.safeParse(rawBody);

    if (!success) {
      const errorDetails = error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));

      return apiResponse(400, {
        message: 'Validation failed',
        errors: errorDetails,
      });
    }

    const updatedFOIARequest = await updateFOIARequest(dto);

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: 'foia-request',
    });

    return apiResponse(200, { foiaRequest: updatedFOIARequest });
  } catch (err: unknown) {
    console.error('Error in updateFOIARequest handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    if (err instanceof Error && err.message === 'FOIA request not found') {
      return apiResponse(404, { message: 'FOIA request not found' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const updateFOIARequest = async (dto: UpdateFOIARequest) => {
  const { orgId, projectId, opportunityId, foiaRequestId } = dto;
  const sortKey = `${orgId}#${projectId}#${opportunityId}#${foiaRequestId}`;

  // Verify the FOIA request exists
  const getCmd = new GetCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: FOIA_REQUEST_PK,
      [SK_NAME]: sortKey,
    },
  });

  const existing = await docClient.send(getCmd);
  if (!existing.Item) {
    throw new Error('FOIA request not found');
  }

  // Build dynamic update expression for provided fields
  const expressionParts: string[] = [];
  const expressionNames: Record<string, string> = {};
  const expressionValues: Record<string, unknown> = {};

  for (const field of UPDATABLE_FIELDS) {
    if (dto[field] !== undefined) {
      const placeholder = `#${field}`;
      const valuePlaceholder = `:${field}`;
      expressionParts.push(`${placeholder} = ${valuePlaceholder}`);
      expressionNames[placeholder] = field;
      expressionValues[valuePlaceholder] = dto[field];
    }
  }

  // Always update updatedAt
  expressionParts.push('#updatedAt = :updatedAt');
  expressionNames['#updatedAt'] = 'updatedAt';
  expressionValues[':updatedAt'] = new Date().toISOString();

  const updateCmd = new UpdateCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: FOIA_REQUEST_PK,
      [SK_NAME]: sortKey,
    },
    UpdateExpression: `SET ${expressionParts.join(', ')}`,
    ExpressionAttributeNames: expressionNames,
    ExpressionAttributeValues: expressionValues,
    ReturnValues: 'ALL_NEW',
  });

  const result = await docClient.send(updateCmd);
  return result.Attributes;
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
