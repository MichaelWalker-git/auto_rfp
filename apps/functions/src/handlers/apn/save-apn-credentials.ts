import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { saveApnCredentials } from '@/helpers/apn';
import { SaveApnCredentialsSchema } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(400, { message: 'orgId is required' });
  }

  const bodyRaw = JSON.parse(event.body || '{}') as Record<string, unknown>;
  const { success, data, error } = SaveApnCredentialsSchema.safeParse({
    ...bodyRaw,
    orgId,
  });

  if (!success) {
    return apiResponse(400, { message: 'Invalid request body', issues: error.issues });
  }

  await saveApnCredentials(data);

  const userId = getUserId(event) ?? 'system';

  setAuditContext(event, {
    action: 'CONFIG_CHANGED',
    resource: 'config',
    resourceId: 'apn-credentials',
    orgId,
  });

  // Non-blocking audit log for credential save
  writeAuditLog(
    {
      logId:          uuidv4(),
      timestamp:      nowIso(),
      userId,
      userName:       (event.auth?.claims?.['cognito:username'] as string | undefined) ?? userId,
      organizationId: orgId,
      action:         'API_KEY_CREATED',
      resource:       'api_key',
      resourceId:     'apn-credentials',
      changes: {
        after: { partnerId: data.partnerId, region: data.region },
      },
      ipAddress:  event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent:  event.headers?.['user-agent'] ?? 'system',
      result:     'success',
    },
    await getHmacSecret(),
  ).catch(err => console.warn('[APN] Audit log failed (non-blocking):', (err as Error).message));

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
