import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';

import { DeleteFOIARequestSchema } from '@auto-rfp/core';
import type { DeleteFOIARequest } from '@auto-rfp/core';
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

export const baseHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const raw = {
      orgId: event.queryStringParameters?.orgId,
      projectId: event.queryStringParameters?.projectId,
      opportunityId: event.queryStringParameters?.opportunityId,
      foiaRequestId: event.queryStringParameters?.foiaRequestId,
    };

    const { success, data: dto, error } = DeleteFOIARequestSchema.safeParse(raw);

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

    await deleteFOIARequest(dto);

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: 'foia-request',
    });

    return apiResponse(200, { message: 'FOIA request deleted', foiaRequestId: dto.foiaRequestId });
  } catch (err: unknown) {
    console.error('Error in deleteFOIARequest handler:', err);

    if (err instanceof Error && err.message === 'FOIA request not found') {
      return apiResponse(404, { message: 'FOIA request not found' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const deleteFOIARequest = async (dto: DeleteFOIARequest): Promise<void> => {
  const { orgId, projectId, opportunityId, foiaRequestId } = dto;
  const sortKey = `${orgId}#${projectId}#${opportunityId}#${foiaRequestId}`;

  // Verify the FOIA request exists before deleting
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

  const deleteCmd = new DeleteCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: FOIA_REQUEST_PK,
      [SK_NAME]: sortKey,
    },
  });

  await docClient.send(deleteCmd);
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
