import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';

import {
  calculateDebriefingDeadline,
  type CreateDebriefingRequest,
  CreateDebriefingRequestSchema,
} from '@auto-rfp/core';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { DEBRIEFING_PK, PROJECT_OUTCOME_PK } from '@/constants/organization';
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

interface AuthContext {
  userId?: string;
}

export const baseHandler = async (
  event: APIGatewayProxyEventV2 & { authContext?: AuthContext }
): Promise<APIGatewayProxyResultV2> => {
  if (!event.body) {
    return apiResponse(400, { message: 'Request body is missing' });
  }

  try {
    const rawBody = JSON.parse(event.body);
    const validationResult = CreateDebriefingRequestSchema.safeParse(rawBody);

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

    const dto: CreateDebriefingRequest = validationResult.data;
    const userId = event.authContext?.userId || 'unknown';

    // Verify project has a LOST outcome
    const outcomeExists = await checkLostOutcome(dto.orgId, dto.projectId);
    if (!outcomeExists) {
      return apiResponse(400, {
        message: 'Debriefing can only be requested for projects with LOST outcome',
      });
    }

    const debriefing = await createDebriefing(dto, userId);

    
    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: 'debriefing',
    });

    return apiResponse(201, { debriefing });
  } catch (err: unknown) {
    console.error('Error in createDebriefing handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

async function checkLostOutcome(orgId: string, projectId: string): Promise<boolean> {
  const cmd = new GetCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: PROJECT_OUTCOME_PK,
      [SK_NAME]: `${orgId}#${projectId}`,
    },
  });

  const result = await docClient.send(cmd);
  return result.Item?.status === 'LOST';
}

export async function createDebriefing(
  dto: CreateDebriefingRequest,
  userId: string
): Promise<DBDebriefingItem> {
  const { projectId, orgId, requestDeadline } = dto;
  const now = new Date().toISOString();
  const debriefId = uuidv4();

  // Calculate deadline (3 business days from now) or use provided deadline
  const deadlineDate = requestDeadline ? new Date(requestDeadline) : calculateDebriefingDeadline(new Date());
  const deadline = deadlineDate.toISOString();

  // Create sort key: orgId#projectId#debriefingId
  const sortKey = `${orgId}#${projectId}#${debriefId}`;

  const debriefingItem: DBDebriefingItem = {
    [PK_NAME]: DEBRIEFING_PK,
    [SK_NAME]: sortKey,
    debriefId,
    projectId,
    orgId,
    requestStatus: 'REQUESTED',
    requestDeadline: deadline,
    createdAt: now,
    updatedAt: now,
    createdBy: userId,
  };

  const cmd = new PutCommand({
    TableName: DB_TABLE_NAME,
    Item: debriefingItem,
  });

  await docClient.send(cmd);

  return debriefingItem;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
