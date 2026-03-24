import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { GrantKBAccessRequestSchema } from '@auto-rfp/core';
import { grantKBAccess, getUserKBAccessRecord } from '@/helpers/user-kb';
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

    const parsed = GrantKBAccessRequestSchema.safeParse(JSON.parse(event.body || ''));
    if (!parsed.success) {
      return apiResponse(400, { message: 'Validation failed', errors: parsed.error.issues });
    }

    const { userId, kbId, accessLevel } = parsed.data;

    // Single DynamoDB GetItem to fetch admin user's access record
    const adminAccess = await getUserKBAccessRecord(adminUserId, kbId);
    const isOrgAdmin = event.rbac?.role === 'ADMIN';

    // Check if user can manage KB access:
    // 1. Has 'admin' accessLevel on this KB (KB owner), OR
    // 2. Has access to this KB AND is org ADMIN role
    const canManage = adminAccess.isKBAdmin || (adminAccess.hasAccess && isOrgAdmin);

    if (!canManage) {
      return apiResponse(403, { message: 'You do not have permission to manage access to this knowledge base' });
    }

    const access = await grantKBAccess(orgId, userId, kbId, accessLevel, adminUserId);

    setAuditContext(event as Parameters<typeof setAuditContext>[0], {
      action: 'KB_ACCESS_GRANTED',
      resource: 'knowledge_base',
      resourceId: kbId,
    });

    return apiResponse(201, access);
  } catch (err) {
    console.error('Error granting KB access:', err);
    return apiResponse(500, { message: 'Failed to grant KB access' });
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
