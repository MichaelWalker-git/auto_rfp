import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { PutCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';

import { SetProjectOutcomeRequestSchema, type SetProjectOutcomeRequest } from '@auto-rfp/core';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { PROJECT_OUTCOME_PK, PROJECT_PK } from '@/constants/organization';
import { apiResponse } from '@/helpers/api';
import { withSentryLambda } from '../../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import type { DBProjectOutcome } from '@/types/project-outcome';

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
    const validationResult = SetProjectOutcomeRequestSchema.safeParse(rawBody);

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

    const dto: SetProjectOutcomeRequest = validationResult.data;
    const userId = event.authContext?.userId || 'unknown';

    // Verify project exists
    const projectExists = await checkProjectExists(dto.orgId, dto.projectId);
    if (!projectExists) {
      return apiResponse(404, { message: 'Project not found' });
    }

    const outcome = await setProjectOutcome(dto, userId);

    return apiResponse(200, { outcome });
  } catch (err: unknown) {
    console.error('Error in setProjectOutcome handler:', err);

    if (err instanceof SyntaxError) {
      return apiResponse(400, { message: 'Invalid JSON in request body' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

async function checkProjectExists(orgId: string, projectId: string): Promise<boolean> {
  const cmd = new GetCommand({
    TableName: DB_TABLE_NAME,
    Key: {
      [PK_NAME]: PROJECT_PK,
      [SK_NAME]: `${orgId}#${projectId}`,
    },
  });

  const result = await docClient.send(cmd);
  return !!result.Item;
}

export async function setProjectOutcome(
  dto: SetProjectOutcomeRequest,
  userId: string
): Promise<DBProjectOutcome> {
  const { projectId, orgId, status, winData, lossData } = dto;
  // opportunityId is now required in the request schema
  const opportunityId = (dto as any).opportunityId as string;
  const now = new Date().toISOString();

  if (!opportunityId) {
    throw new Error('opportunityId is required');
  }

  // Create sort key: orgId#projectId#opportunityId (opportunityId is now required)
  const sortKey = `${orgId}#${projectId}#${opportunityId}`;

  const outcomeItem = {
    [PK_NAME]: PROJECT_OUTCOME_PK,
    [SK_NAME]: sortKey,
    projectId,
    orgId,
    opportunityId,
    status,
    statusDate: now,
    statusSetBy: userId,
    statusSource: 'MANUAL' as const,
    winData,
    lossData,
    createdAt: now,
    updatedAt: now,
  } as DBProjectOutcome;

  // Use PutCommand to create or update the outcome
  const cmd = new PutCommand({
    TableName: DB_TABLE_NAME,
    Item: outcomeItem,
  });

  await docClient.send(cmd);

  return outcomeItem;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:edit'))
    .use(httpErrorMiddleware())
);
