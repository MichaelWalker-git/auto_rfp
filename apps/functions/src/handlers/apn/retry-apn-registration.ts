import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { retryApnRegistration } from '@/helpers/apn';
import { RetryApnRegistrationSchema } from '@auto-rfp/core';
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

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) {
    return apiResponse(400, { message: 'orgId is required' });
  }

  const bodyRaw = JSON.parse(event.body || '{}') as Record<string, unknown>;
  const { success, data, error } = RetryApnRegistrationSchema.safeParse({
    ...bodyRaw,
    orgId,
  });

  if (!success) {
    return apiResponse(400, { message: 'Invalid request body', issues: error.issues });
  }

  const userId = getUserId(event) ?? 'system';

  try {
    const registration = await retryApnRegistration({
      orgId:          data.orgId,
      projectId:      data.projectId,
      oppId:          data.oppId,
      registrationId: data.registrationId,
      retriedBy:      userId,
    });

    setAuditContext(event, {
      action:     'INTEGRATION_SYNC_COMPLETED',
      resource:   'apn_registration',
      resourceId: data.registrationId,
      orgId,
    });

    return apiResponse(200, { ok: true, registration });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Unknown error';

    // Non-blocking audit log for retry failure
    writeAuditLog(
      {
        logId:          uuidv4(),
        timestamp:      nowIso(),
        userId,
        userName:       (event.auth?.claims?.['cognito:username'] as string | undefined) ?? userId,
        organizationId: orgId,
        action:         'INTEGRATION_SYNC_FAILED',
        resource:       'apn_registration',
        resourceId:     data.registrationId,
        changes: {
          after: { error: errorMessage.substring(0, 500) },
        },
        ipAddress:    event.requestContext?.http?.sourceIp ?? '0.0.0.0',
        userAgent:    event.headers?.['user-agent'] ?? 'system',
        result:       'failure',
        errorMessage: errorMessage.substring(0, 500),
      },
      await getHmacSecret(),
    ).catch(e => console.warn('[APN] Audit log failed (non-blocking):', (e as Error).message));

    return apiResponse(500, { message: errorMessage });
  }
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('opportunity:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
