import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { withSentryLambda } from '@/sentry-lambda';
import { ConfirmDisclosureRequestSchema } from '@auto-rfp/core';
import { confirmDisclosureRows } from '@/helpers/past-performance';
import { apiResponse } from '@/helpers/api';
import { nowIso } from '@/helpers/date';
import {
  authContextMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  httpErrorMiddleware,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

export const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  let raw: unknown;
  try {
    raw = JSON.parse(event.body || '{}');
  } catch {
    return apiResponse(400, { message: 'Invalid JSON in request body' });
  }

  const { success, data, error } = ConfirmDisclosureRequestSchema.safeParse(raw);
  if (!success) return apiResponse(400, { message: 'Invalid payload', issues: error.issues });

  const userId = event.auth?.userId ?? 'system';
  const now = nowIso();

  // The only path that flips disclosureConfirmed=true and stamps the reviewer.
  const confirmed = await confirmDisclosureRows(data.orgId, data.rows, userId, now);

  setAuditContext(event, {
    action: 'PAST_PERF_DISCLOSURE_CONFIRMED',
    resource: 'past_project',
    resourceId: data.orgId,
  });

  return apiResponse(200, { confirmed });
};

export const handler = withSentryLambda(
  middy(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('kb:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
