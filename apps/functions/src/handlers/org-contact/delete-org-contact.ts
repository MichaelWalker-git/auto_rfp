import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';
import { deleteOrgPrimaryContact } from '@/helpers/org-contact';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId } = event.pathParameters ?? {};
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  await deleteOrgPrimaryContact(orgId);

  setAuditContext(event, {
    action: 'ORG_SETTINGS_CHANGED',
    resource: 'organization',
    resourceId: orgId,
  });

  return apiResponse(204, {});
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:manage_settings'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
