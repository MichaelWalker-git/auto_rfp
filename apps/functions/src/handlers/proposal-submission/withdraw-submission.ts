import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import { withdrawSubmissionRecord } from '@/helpers/proposal-submission';
import { WithdrawSubmissionSchema } from '@auto-rfp/core';
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
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const bodyRaw = JSON.parse(event.body || '{}') as Record<string, unknown>;
  const { success, data, error } = WithdrawSubmissionSchema.safeParse({ ...bodyRaw, orgId });
  if (!success) return apiResponse(400, { message: 'Invalid request body', issues: error.issues });

  const userId = getUserId(event) ?? 'system';
  const userName = (event.auth?.claims?.['cognito:username'] as string | undefined) ?? userId;

  await withdrawSubmissionRecord(
    data.orgId,
    data.projectId,
    data.oppId,
    data.submissionId,
    userId,
    data.withdrawalReason,
  );

  setAuditContext(event, {
    action: 'PROPOSAL_SUBMITTED',
    resource: 'proposal',
    resourceId: data.submissionId,
    orgId: data.orgId,
  });

  writeAuditLog(
    {
      logId: uuidv4(),
      timestamp: nowIso(),
      userId,
      userName,
      organizationId: data.orgId,
      action: 'PROPOSAL_SUBMITTED',
      resource: 'proposal',
      resourceId: data.submissionId,
      changes: {
        before: { status: 'SUBMITTED' },
        after: { status: 'WITHDRAWN', withdrawalReason: data.withdrawalReason },
      },
      ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent: event.headers?.['user-agent'] ?? 'system',
      result: 'success',
    },
    await getHmacSecret(),
  ).catch((err) => console.warn('[withdraw-submission] Audit log failed:', (err as Error).message));

  return apiResponse(200, { ok: true });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:edit'))
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);
