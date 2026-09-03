import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';

import { ORG_PK } from '@/constants/organization';
import { SK_NAME } from '@/constants/common';
import { apiResponse } from '@/helpers/api';
import { deleteItemWithRetry } from '@/helpers/db';
import {
  deleteProjectAndRelatedEntities,
  extractProjectIdFromSk,
  getProjectsByOrgId,
} from '@/helpers/project-cleanup';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

const PROJECT_DELETE_CONCURRENCY = 4;

interface DeleteOrgResult {
  projects: {
    total: number;
    deleted: number;
    failed: number;
  };
  organization: boolean;
}

async function deleteOrganizationWithCleanup(orgId: string): Promise<DeleteOrgResult> {
  const result: DeleteOrgResult = {
    projects: { total: 0, deleted: 0, failed: 0 },
    organization: false,
  };

  // Get and delete all projects
  const projects = await getProjectsByOrgId(orgId);
  result.projects.total = projects.length;

  const projectIds: string[] = [];
  for (const project of projects) {
    const projectId = project.projectId || extractProjectIdFromSk(project[SK_NAME], orgId);
    if (projectId) {
      projectIds.push(projectId);
    } else {
      result.projects.failed++;
    }
  }

  // Each project cleanup is a handful of Queries plus batched deletes. The whole
  // org delete has to finish inside one 30-second API Gateway request, so run
  // the cleanups through a small pool rather than strictly one after another.
  // The pool stays small to keep DynamoDB write throttling in check.
  const deleteOne = async (projectId: string): Promise<void> => {
    try {
      await deleteProjectAndRelatedEntities(orgId, projectId);
      result.projects.deleted++;
    } catch (err) {
      console.error(`Failed to delete project ${projectId}:`, err);
      result.projects.failed++;
    }
  };

  const queue = [...projectIds];
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      await deleteOne(next);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PROJECT_DELETE_CONCURRENCY, projectIds.length) }, worker),
  );

  // Delete organization
  result.organization = await deleteItemWithRetry(ORG_PK, `ORG#${orgId}`);

  return result;
}

export const baseHandler = async (
  event: AuthedEvent,
): Promise<APIGatewayProxyResultV2> => {
  try {
    const orgId = event.pathParameters?.id;

    if (!orgId) {
      return apiResponse(400, { message: 'Missing required path parameter: id' });
    }

    const cleanup = await deleteOrganizationWithCleanup(orgId);

    setAuditContext(event, {
      action: 'ORG_SETTINGS_CHANGED',
      resource: 'organization',
      resourceId: orgId,
    });

    return apiResponse(200, {
      success: true,
      message: 'Organization deleted successfully',
      id: orgId,
      cleanup,
    });
  } catch (err: any) {
    console.error('Error in deleteOrganization handler:', err);

    if (err?.name === 'ConditionalCheckFailedException') {
      return apiResponse(404, { message: 'Organization not found' });
    }

    return apiResponse(500, {
      message: 'Internal server error',
      error: err instanceof Error ? err.message : 'Unknown error',
    });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:delete'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);