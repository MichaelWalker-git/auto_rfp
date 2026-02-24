import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { LinkKBToProjectRequestSchema } from '@auto-rfp/core';
import { linkKBToProject } from '@/helpers/project-kb';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import middy from '@middy/core';

export const baseHandler = async (event: APIGatewayProxyEventV2) => {
  try {
    const userId = getUserId(event);

    const { success, error, data } = LinkKBToProjectRequestSchema.safeParse(JSON.parse(event.body || ''));
    if (!success) {
      return apiResponse(400, { message: 'Validation failed', errors: error.issues });
    }

    const { orgId, projectId, kbId } = data;

    const link = await linkKBToProject(orgId, projectId, kbId, userId ?? undefined);

    
    setAuditContext(event, {
      action: 'CONFIG_CHANGED',
      resource: 'config',
      resourceId: 'unknown',
    });

    return apiResponse(201, link);
  } catch (err: any) {
    if (err?.name === 'ConditionalCheckFailedException') {
      return apiResponse(409, { message: 'Knowledge base is already linked to this project' });
    }
    console.error('Error linking KB to project:', err);
    return apiResponse(500, { message: 'Failed to link knowledge base to project' });
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
