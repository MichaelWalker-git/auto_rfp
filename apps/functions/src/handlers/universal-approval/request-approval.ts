import type { APIGatewayProxyResultV2 } from 'aws-lambda';
import middy from '@middy/core';
import { v4 as uuidv4 } from 'uuid';
import { apiResponse, getOrgId, getUserId } from '@/helpers/api';
import { withSentryLambda } from '@/sentry-lambda';
import {
  createUniversalApprovalRecord,
  cancelPendingUniversalApprovals,
  updateUniversalApprovalLinearTicket,
} from '@/helpers/universal-approval';
import { getUserByOrgAndId } from '@/helpers/user';
import { sendNotification, buildNotification } from '@/helpers/send-notification';
import { createLinearTicket } from '@/helpers/linear';
import { writeAuditLog } from '@/helpers/audit-log';
import { getHmacSecret } from '@/helpers/secret';
import { nowIso } from '@/helpers/date';
import { RequestUniversalApprovalSchema, getEntityDisplayName, getEntityIcon, getAuditResourceType } from '@auto-rfp/core';
import {
  authContextMiddleware,
  httpErrorMiddleware,
  orgMembershipMiddleware,
  requirePermission,
  type AuthedEvent,
} from '@/middleware/rbac-middleware';
import { auditMiddleware, setAuditContext } from '@/middleware/audit-middleware';

const baseHandler = async (event: AuthedEvent): Promise<APIGatewayProxyResultV2> => {
  const orgId = getOrgId(event);
  if (!orgId) return apiResponse(400, { message: 'orgId is required' });

  const bodyRaw = JSON.parse(event.body || '{}') as Record<string, unknown>;
  const { success, data, error } = RequestUniversalApprovalSchema.safeParse({ ...bodyRaw, orgId });
  if (!success) return apiResponse(400, { message: 'Invalid request body', issues: error.issues });

  const requestedBy = getUserId(event) ?? 'system';

  // ── Guard: cannot request approval from yourself ──
  if (data.reviewerId === requestedBy) {
    return apiResponse(400, { message: 'You cannot request approval from yourself' });
  }

  // ── Load requester and reviewer ──
  const [requester, reviewer] = await Promise.all([
    getUserByOrgAndId(orgId, requestedBy).catch(() => null),
    getUserByOrgAndId(orgId, data.reviewerId),
  ]);
  
  if (!reviewer) return apiResponse(404, { message: 'Reviewer not found in this organization' });
  
  const requestedByName = requester?.displayName ?? requester?.firstName ?? requester?.email ?? requestedBy;

  // ── Cancel any existing PENDING approvals for this entity ──
  await cancelPendingUniversalApprovals(orgId, data.entityType, data.entitySK);

  // ── Create approval record ──
  const approval = await createUniversalApprovalRecord(
    data,
    requestedBy,
    requestedByName,
    reviewer.displayName ?? reviewer.firstName ?? reviewer.email,
    reviewer.email,
  );

  // ── Create Linear ticket for the reviewer (non-blocking) ──
  const entityDisplayName = getEntityDisplayName(data.entityType);
  const entityIcon = getEntityIcon(data.entityType);
  
  createLinearTicket({
    orgId,
    title: `[Review] ${data.entityName ?? entityDisplayName} — Approval Required`,
    description: [
      `## ${entityDisplayName} Approval Request`,
      ``,
      `**${entityDisplayName}:** ${data.entityName ?? 'Untitled'}`,
      `**Type:** ${entityDisplayName}`,
      `**Requested by:** ${requestedByName}`,
      `**Requested at:** ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`,
      ``,
      `## Instructions`,
      `1. Review the ${entityDisplayName.toLowerCase()} in Auto RFP`,
      `2. Click **Approve** or **Reject** in the approval panel`,
      `3. The ticket will be reassigned back to the requester automatically`,
      ``,
      `**Approval ID:** \`${approval.approvalId}\``,
      `**Entity Type:** \`${data.entityType}\``,
      `**Entity ID:** \`${data.entityId}\``,
    ].join('\n'),
    priority: 2,
    labels: ['universal-approval', 'Auto-Generated'],
  })
    .then(async (ticket) => {
      if (!ticket) return;
      // Store the Linear ticket reference on the approval record (status stays PENDING)
      await updateUniversalApprovalLinearTicket(
        orgId, data.entityType, data.entitySK, approval.approvalId,
        {
          linearTicketId: ticket.id,
          linearTicketIdentifier: ticket.identifier ?? undefined,
          linearTicketUrl: ticket.url ?? undefined,
        },
      );
    })
    .catch((err) => console.warn('[request-universal-approval] Linear ticket creation failed:', (err as Error).message));

  // ── Notify reviewer (non-blocking) ──
  sendNotification(
    buildNotification(
      'DOCUMENT_APPROVAL_REQUESTED', // Using existing notification type for compatibility
      `${entityIcon} ${entityDisplayName} Review Requested`,
      `${requestedByName} has requested your approval for "${data.entityName ?? `a ${entityDisplayName.toLowerCase()}`}"`,
      {
        orgId,
        projectId: data.projectId ?? '',
        entityId: data.entityId,
        recipientUserIds: [data.reviewerId],
        recipientEmails: reviewer.email ? [reviewer.email] : [],
        actorDisplayName: requestedByName,
      },
    ),
  ).catch((err) => console.warn('[request-universal-approval] Notification failed:', (err as Error).message));

  // ── Audit log (non-blocking) ──
  writeAuditLog(
    {
      logId: uuidv4(),
      timestamp: nowIso(),
      userId: requestedBy,
      userName: requestedByName,
      organizationId: orgId,
      action: 'DOCUMENT_APPROVAL_REQUESTED', // Using existing action for compatibility
      resource: getAuditResourceType(data.entityType),
      resourceId: data.entityId,
      changes: {
        after: {
          approvalId: approval.approvalId,
          reviewerId: data.reviewerId,
          entityType: data.entityType,
          entityName: data.entityName,
        },
      },
      ipAddress: event.requestContext?.http?.sourceIp ?? '0.0.0.0',
      userAgent: event.headers?.['user-agent'] ?? 'system',
      result: 'success',
    },
    await getHmacSecret(),
  ).catch((err) => console.warn('[request-universal-approval] Audit log failed:', (err as Error).message));

  setAuditContext(event, {
    action: 'DOCUMENT_APPROVAL_REQUESTED',
    resource: getAuditResourceType(data.entityType),
    resourceId: data.entityId,
    orgId,
  });

  return apiResponse(200, { ok: true, approval });
};

export const handler = withSentryLambda(
  middy<AuthedEvent, APIGatewayProxyResultV2>(baseHandler)
    .use(authContextMiddleware())
    .use(orgMembershipMiddleware())
    .use(requirePermission('proposal:edit')) // Using existing permission for now
    .use(auditMiddleware())
    .use(httpErrorMiddleware()),
);