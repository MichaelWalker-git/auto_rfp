import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { GrantKBAccessRequestSchema } from '@auto-rfp/core';
import { grantKBAccess } from '@/helpers/user-kb';
import { withSentryLambda } from '@/sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import middy from '@middy/core';

export const baseHandler = async (event: APIGatewayProxyEventV2) => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'Org Id is required' });

    const adminUserId = getUserId(event);
    const parsed = GrantKBAccessRequestSchema.safeParse(JSON.parse(event.body || ''));
    if (!parsed.success) {
      return apiResponse(400, { message: 'Validation failed', errors: parsed.error.issues });
    }

    const { userId, kbId, accessLevel } = parsed.data;

    // Prevent self-modification
    if (adminUserId && userId === adminUserId) {
      return apiResponse(400, { message: 'You cannot modify your own KB access permissions' });
    }

    const access = await grantKBAccess(orgId, userId, kbId, accessLevel, adminUserId ?? undefined);

    setAuditContext(event as Parameters<typeof setAuditContext>[0], {
      action: 'ORG_MEMBER_ADDED',
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
