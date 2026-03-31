import { APIGatewayProxyResultV2, } from 'aws-lambda';
import { QueryCommand, } from '@aws-sdk/lib-dynamodb';
import { PK_NAME, SK_NAME } from '@/constants/common';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { PROJECT_PK } from '@/constants/organization';
import { withSentryLambda } from '@/sentry-lambda';
import { requireEnv } from '@/helpers/env';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import middy from '@middy/core';
import { docClient } from '@/helpers/db';
import { getAccessibleProjectIds } from '@/helpers/user-project';

const DB_TABLE_NAME = requireEnv('DB_TABLE_NAME');

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  const userId = getUserId(event);

  if (!orgId) {
    return apiResponse(400, { message: 'orgId is required' });
  }

  try {
    // Get all projects for the org
    const allProjects = await listProjects(orgId);

    // Get user's explicit project assignments
    const assignedProjectIds = userId ? await getAccessibleProjectIds(userId) : [];
    const assignedSet = new Set(assignedProjectIds);

    // Filter projects with the following rules:
    // 1. LEGACY projects (no createdBy) → always visible to all org members
    // 2. NEW projects (with createdBy) → visible ONLY if user has explicit assignment
    //    (creator is auto-assigned on project creation, so createdBy check is not needed)
    const visibleProjects = allProjects.filter((project) => {
      // Legacy project (created before assignment feature) - always visible
      if (!project.createdBy) {
        return true;
      }

      // New project - check explicit assignment only
      return assignedSet.has(project.id);
    });

    return apiResponse(200, visibleProjects);
  } catch (err) {
    console.error('Error in projects handler:', err);
    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export async function listProjects(orgId: string): Promise<any[]> {
  const items: any[] = [];
  let ExclusiveStartKey: Record<string, any> | undefined = undefined;

  do {
    const res = await docClient.send(
      new QueryCommand({
        TableName: DB_TABLE_NAME,

        KeyConditionExpression: '#pk = :pkValue AND begins_with(#sk, :skPrefix)',

        ExpressionAttributeNames: {
          '#pk': PK_NAME,
          '#sk': SK_NAME,
        },
        ExpressionAttributeValues: {
          ':pkValue': PROJECT_PK,
          ':skPrefix': orgId,
        },
        ExclusiveStartKey,
      }),
    );

    if (res.Items && res.Items.length > 0) {
      items.push(...res.Items);
    }

    ExclusiveStartKey = res.LastEvaluatedKey as Record<string, any> | undefined;
  } while (ExclusiveStartKey);

  return items;
}

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('project:read'))
    .use(httpErrorMiddleware()),
);
