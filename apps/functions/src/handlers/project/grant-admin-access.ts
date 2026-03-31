import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { GrantAdminAccessRequestSchema } from '@auto-rfp/core';
import { grantProjectAccessToAllAdmins, getUserProjectAccessRecord } from '@/helpers/user-project';
import { getProjectById } from '@/helpers/project';
import { listOrgAdmins } from '@/helpers/user';
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

export const baseHandler = async (event: AuthedEvent) => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'Org Id is required' });

    const adminUserId = getUserId(event);
    if (!adminUserId) {
      return apiResponse(401, { message: 'Unauthorized' });
    }

    const { success, data, error } = GrantAdminAccessRequestSchema.safeParse(JSON.parse(event.body || '{}'));
    if (!success) {
      return apiResponse(400, { message: 'Validation failed', errors: error.issues });
    }

    const { projectId } = data;

    // Check project exists and belongs to org
    const project = await getProjectById(projectId);
    if (!project || project.orgId !== orgId) {
      return apiResponse(404, { message: 'Project not found' });
    }

    // Check if admin user can manage project access
    const isProjectCreator = project.createdBy === adminUserId;
    const adminAccess = await getUserProjectAccessRecord(adminUserId, projectId);
    const isOrgAdmin = event.rbac?.role === 'ADMIN';
    const canManage = isProjectCreator || (adminAccess.hasAccess && isOrgAdmin);

    if (!canManage) {
      return apiResponse(403, { message: 'You do not have permission to manage access to this project' });
    }

    // Get all users with ADMIN role in the org
    const adminUsers = await listOrgAdmins(orgId);
    const adminUserIds = adminUsers.map((u) => u.userId);

    // Grant access to all admins
    const { grantedCount, skippedCount, grantedUserIds } = await grantProjectAccessToAllAdmins(
      orgId,
      projectId,
      adminUserId,
      adminUserIds,
    );

    setAuditContext(event as Parameters<typeof setAuditContext>[0], {
      action: 'PROJECT_ACCESS_GRANTED_TO_ADMINS',
      resource: 'project',
      resourceId: projectId,
      orgId,
      changes: { after: { grantedCount, grantedUserIds } },
    });

    return apiResponse(200, {
      projectId,
      grantedCount,
      skippedCount,
      adminUserIds: grantedUserIds,
    });
  } catch (err) {
    console.error('Error granting admin access:', err);
    return apiResponse(500, { message: 'Failed to grant admin access' });
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
