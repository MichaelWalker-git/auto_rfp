import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import { apiResponse } from '@/helpers/api';
import { getOrgPrimaryContact } from '@/helpers/org-contact';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const { orgId } = event.pathParameters ?? {};
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const contact = await getOrgPrimaryContact(orgId);
  if (!contact) {
    return apiResponse(404, { message: 'No primary contact configured for this organization' });
  }

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
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
