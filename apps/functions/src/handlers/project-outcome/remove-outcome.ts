import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import { DeleteCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import middy from '@middy/core';

import { PK_NAME, SK_NAME } from '@/constants/common';
import { PROJECT_OUTCOME_PK } from '@/constants/organization';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { requireEnv } from '@/helpers/env';
import { docClient } from '@/helpers/db';
import { transitionOpportunityStage } from '@/helpers/opportunity-stage';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { error: 'Missing orgId' });

    const qs = event.queryStringParameters ?? {};
    const { projectId, opportunityId } = qs;
    if (!projectId) return apiResponse(400, { error: 'Missing projectId' });
    if (!opportunityId) return apiResponse(400, { error: 'Missing opportunityId' });

    const sortKey = `${orgId}#${projectId}#${opportunityId}`;

    // Check outcome exists
    const existing = await docClient.send(new GetCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: PROJECT_OUTCOME_PK, [SK_NAME]: sortKey },
    }));

    if (!existing.Item) {
      return apiResponse(404, { error: 'No outcome found for this opportunity' });
    }

    // Delete outcome record
    await docClient.send(new DeleteCommand({
      TableName: DB_TABLE_NAME,
      Key: { [PK_NAME]: PROJECT_OUTCOME_PK, [SK_NAME]: sortKey },
    }));

    // Revert opportunity stage to SUBMITTED
    const userId = (event as AuthedEvent & { auth?: { userId?: string } }).auth?.userId ?? 'system';
    try {
      await transitionOpportunityStage({
        orgId,
        projectId,
        oppId: opportunityId,
        toStage: 'SUBMITTED',
        changedBy: userId,
        reason: 'Outcome removed',
        source: 'MANUAL',
      });
    } catch (err) {
      console.warn('[remove-outcome] Failed to revert opportunity stage:', (err as Error)?.message);
    }

    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: `${projectId}#${opportunityId}`,
      orgId,
    });

    return apiResponse(200, { message: 'Outcome removed', projectId, opportunityId });
  } catch (err) {
    console.error('Error removing outcome:', err);
    return apiResponse(500, {
      error: 'Internal server error',
      message: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
