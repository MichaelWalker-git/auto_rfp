import { APIGatewayProxyEventV2 } from 'aws-lambda';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { RevokeKBAccessRequestSchema } from '@auto-rfp/core';
import { revokeKBAccess } from '@/helpers/user-kb';
import { withSentryLambda } from '../../sentry-lambda';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
} from '@/middleware/rbac-middleware';
import middy from '@middy/core';

export const baseHandler = async (event: APIGatewayProxyEventV2) => {
  try {
    const orgId = getOrgId(event);
    if (!orgId) return apiResponse(400, { message: 'Org Id is required' });

    const parsed = RevokeKBAccessRequestSchema.safeParse(JSON.parse(event.body || ''));
    if (!parsed.success) {
      return apiResponse(400, { message: 'Validation failed', errors: parsed.error.issues });
    }

    const { userId, kbId } = parsed.data;

    // Prevent self-modification
    const adminUserId = getUserId(event);
    if (adminUserId && userId === adminUserId) {
      return apiResponse(400, { message: 'You cannot modify your own KB access permissions' });
    }

    await revokeKBAccess(userId, kbId);

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
    .use(httpErrorMiddleware()),
);
