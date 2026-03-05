import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { apiResponse, getOrgId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { saveApnCredentials } from '@/helpers/apn-db';
import { SaveApnCredentialsSchema } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(400, { message: 'orgId is required' });
  }

  const bodyRaw: unknown = JSON.parse(event.body || '{}');
  const { success, data, error } = SaveApnCredentialsSchema.safeParse({
    ...(bodyRaw as Record<string, unknown>),
    orgId,
  });

  if (!success) {
    return apiResponse(400, { message: 'Invalid request body', issues: error.issues });
  }

  await saveApnCredentials(data);

  setAuditContext(event, {
    action:     'CONFIG_CHANGED',
    resource:   'config',
    resourceId: 'apn-credentials',
    orgId,
    changes: { after: { partnerId: data.partnerId, region: data.region } },
  });

  return apiResponse(200, {
    ok: true,
    message: 'APN credentials saved successfully',
  });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('org:manage_settings'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
