import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { RevokeKBAccessRequestSchema } from '@auto-rfp/core';
import { revokeKBAccess, canManageKBAccess, hasKBAccess } from '@/helpers/user-kb';
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

    const parsed = RevokeKBAccessRequestSchema.safeParse(JSON.parse(event.body || ''));
    if (!parsed.success) {
      return apiResponse(400, { message: 'Validation failed', errors: parsed.error.issues });
    }

    const { userId, kbId } = parsed.data;

    // Check if user can manage KB access:
    // 1. Has 'admin' accessLevel on this KB (KB owner), OR
    // 2. Has access to this KB AND is org ADMIN role
    const hasKBAdminAccess = await canManageKBAccess(adminUserId, kbId);
    const isOrgAdmin = event.rbac?.role === 'ADMIN';
    const hasAccessToKB = await hasKBAccess(adminUserId, kbId);

    const canManage = hasKBAdminAccess || (hasAccessToKB && isOrgAdmin);

    if (!canManage) {
      return apiResponse(403, { message: 'You do not have permission to manage access to this knowledge base' });
    }

    await revokeKBAccess(userId, kbId);

    
    setAuditContext(event, {
      action: 'KB_ACCESS_REVOKED',
      resource: 'knowledge_base',
      resourceId: kbId,
    });

    return apiResponse(200, { message: 'KB access revoked', userId, kbId });
  } catch (err) {
    console.error('Error revoking KB access:', err);
    return apiResponse(500, { message: 'Failed to revoke KB access' });
  }
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('kb:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
