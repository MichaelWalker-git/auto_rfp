import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';

import { DeleteDebriefingRequestSchema } from '@auto-rfp/core';
import type { DeleteDebriefingRequest } from '@auto-rfp/core';
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

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  try {
    const raw = {
      orgId: event.queryStringParameters?.orgId,
      projectId: event.queryStringParameters?.projectId,
      opportunityId: event.queryStringParameters?.opportunityId,
      debriefingId: event.queryStringParameters?.debriefingId,
    };

    const { success, data: dto, error } = DeleteDebriefingRequestSchema.safeParse(raw);

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

    await deleteDebriefing(dto);

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: 'debriefing',
    });

    return apiResponse(200, { message: 'Debriefing deleted', debriefingId: dto.debriefingId });
  } catch (err: unknown) {
    console.error('Error in deleteDebriefing handler:', err);

    if (err instanceof Error && err.message === 'Debriefing not found') {
      return apiResponse(404, { message: 'Debriefing not found' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const deleteDebriefing = async (dto: DeleteDebriefingRequest): Promise<void> => {
  const { orgId, projectId, opportunityId, debriefingId } = dto;
  const sortKey = `${orgId}#${projectId}#${opportunityId}#${debriefingId}`;

  // Verify the debriefing exists before deleting
  const getCmd = new GetCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: DEBRIEFING_PK,
      [SK_NAME]: sortKey,
    },
  });

  const existing = await docClient.send(getCmd);
  if (!existing.Item) {
    throw new Error('Debriefing not found');
  }

  const deleteCmd = new DeleteCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: DEBRIEFING_PK,
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
