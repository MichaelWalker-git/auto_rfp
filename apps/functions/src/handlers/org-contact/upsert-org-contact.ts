import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse, getUserId } from '@/helpers/api';
import { upsertOrgPrimaryContact } from '@/helpers/org-contact';
import { CreateOrgPrimaryContactSchema } from '@auto-rfp/core';
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

  const userId = getUserId(event) ?? 'system';

  const { success, data, error } = CreateOrgPrimaryContactSchema.safeParse(
    JSON.parse(event.body ?? '{}'),
  );
  if (!success) {
    return apiResponse(400, { message: 'Invalid payload', issues: error.issues });
  }

  const contact = await upsertOrgPrimaryContact(orgId, data, userId);

  setAuditContext(event, {
    action: 'ORG_SETTINGS_CHANGED',
    resource: 'organization',
    resourceId: orgId,
  });

  return apiResponse(200, { contact });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:manage_settings'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
